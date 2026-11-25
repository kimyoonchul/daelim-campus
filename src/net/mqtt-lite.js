// 아주 작은 MQTT 3.1.1 클라이언트 (WebSocket 전용, QoS 0만).
// 브라우저와 Node 22+ (전역 WebSocket) 양쪽에서 그대로 동작한다.
// 필요한 것만 구현: CONNECT(+유언 메시지), SUBSCRIBE, PUBLISH, PING, DISCONNECT.

const te = new TextEncoder();
const td = new TextDecoder();

function varLen(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 128;
    out.push(b);
  } while (n > 0);
  return out;
}

function utf8(s) {
  const b = typeof s === 'string' ? te.encode(s) : s;
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8;
  out[1] = b.length & 255;
  out.set(b, 2);
  return out;
}

function packet(type, parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const head = [type, ...varLen(len)];
  const out = new Uint8Array(head.length + len);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export class MqttLite {
  /**
   * @param {string} url wss://host:port/path
   * @param {{clientId:string, keepAlive?:number, will?:{topic:string,payload:string}, connectTimeout?:number}} opts
   */
  constructor(url, opts = {}) {
    this.url = url;
    this.clientId = opts.clientId || 'c' + Math.random().toString(36).slice(2, 12);
    this.keepAlive = opts.keepAlive || 60;
    this.will = opts.will || null;
    this.connectTimeout = opts.connectTimeout || 8000;
    this.connected = false;
    this.closed = false;
    this.ws = null;
    this.buf = new Uint8Array(0);
    this.pid = 1;
    this.lastRx = 0;
    this.onmessage = null; // (topic, payloadString) => void
    this.onclose = null; // (reason) => void
    this._pingTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (why) => {
        if (settled) return;
        settled = true;
        this._teardown(why);
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail('timeout'), this.connectTimeout);
      let ws;
      try {
        ws = new WebSocket(this.url, ['mqtt']);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        // 접속 플래그: clean session(0x02) + 유언(0x04)
        let flags = 0x02;
        const payload = [utf8(this.clientId)];
        if (this.will) {
          flags |= 0x04;
          payload.push(utf8(this.will.topic), utf8(this.will.payload));
        }
        const vh = new Uint8Array([0, 4, 77, 81, 84, 84, 4, flags, this.keepAlive >> 8, this.keepAlive & 255]);
        ws.send(packet(0x10, [vh, ...payload]));
      };
      ws.onmessage = (ev) => {
        this.lastRx = Date.now();
        this._feed(new Uint8Array(ev.data), (rc) => {
          if (settled) return;
          clearTimeout(timer);
          if (rc === 0) {
            settled = true;
            this.connected = true;
            this._startPing();
            resolve(this);
          } else fail('connack ' + rc);
        });
      };
      ws.onerror = () => {
        clearTimeout(timer);
        fail('socket error');
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!settled) fail('closed before connack');
        else this._teardown('socket closed');
      };
    });
  }

  _startPing() {
    const every = Math.max(5, Math.floor(this.keepAlive / 2.4)) * 1000;
    this._pingTimer = setInterval(() => {
      if (!this.connected) return;
      if (Date.now() - this.lastRx > this.keepAlive * 1500) {
        this._teardown('ping timeout');
        return;
      }
      this._send(new Uint8Array([0xc0, 0]));
    }, every);
  }

  _send(bytes) {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(bytes);
        return true;
      } catch (e) {
        /* 무시: 닫히는 중 */
      }
    }
    return false;
  }

  _feed(chunk, onConnack) {
    // 조각나거나 붙어서 온 프레임을 패킷 단위로 자른다
    let buf = chunk;
    if (this.buf.length) {
      buf = new Uint8Array(this.buf.length + chunk.length);
      buf.set(this.buf, 0);
      buf.set(chunk, this.buf.length);
    }
    let o = 0;
    while (buf.length - o >= 2) {
      let mult = 1;
      let len = 0;
      let i = o + 1;
      let ok = false;
      while (i < buf.length && i < o + 5) {
        const b = buf[i++];
        len += (b & 127) * mult;
        mult *= 128;
        if (!(b & 128)) {
          ok = true;
          break;
        }
      }
      if (!ok || buf.length - i < len) break;
      this._handle(buf[o] >> 4, buf[o] & 15, buf.subarray(i, i + len), onConnack);
      o = i + len;
    }
    this.buf = o < buf.length ? buf.slice(o) : new Uint8Array(0);
  }

  _handle(type, flags, body, onConnack) {
    if (type === 2) {
      onConnack && onConnack(body[1]);
    } else if (type === 3) {
      const tl = (body[0] << 8) | body[1];
      const topic = td.decode(body.subarray(2, 2 + tl));
      let o = 2 + tl;
      const qos = (flags >> 1) & 3;
      if (qos > 0) {
        if (qos === 1) this._send(new Uint8Array([0x40, 2, body[o], body[o + 1]]));
        o += 2;
      }
      if (this.onmessage) {
        let text = '';
        try {
          text = td.decode(body.subarray(o));
        } catch (e) {
          return;
        }
        this.onmessage(topic, text);
      }
    }
    // SUBACK(9), PINGRESP(13)은 lastRx 갱신만으로 충분
  }

  subscribe(filter) {
    const id = this.pid++ & 0xffff || 1;
    return this._send(packet(0x82, [new Uint8Array([id >> 8, id & 255]), utf8(filter), new Uint8Array([0])]));
  }

  publish(topic, payload, retain = false) {
    if (!this.connected) return false;
    const body = typeof payload === 'string' ? te.encode(payload) : payload;
    return this._send(packet(retain ? 0x31 : 0x30, [utf8(topic), body]));
  }

  /** 정상 종료: DISCONNECT를 보내므로 유언 메시지는 나가지 않는다 */
  close() {
    this.closed = true;
    this._send(new Uint8Array([0xe0, 0]));
    this._teardown('closed');
  }

  /** 비정상 종료 흉내(테스트용): 유언 메시지가 나간다 */
  drop() {
    this.closed = true;
    this._teardown('dropped');
  }

  _teardown(reason) {
    const was = this.connected;
    this.connected = false;
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch (e) {
        /* 무시 */
      }
    }
    if (was && this.onclose) this.onclose(reason);
  }
}
