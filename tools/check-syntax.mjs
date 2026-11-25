// 모든 소스 파일의 문법과 숨은 제어문자를 점검한다: node tools/check-syntax.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name === 'vendor' || f.name.startsWith('.')) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(js|mjs|html|css)$/.test(f.name)) files.push(p);
  }
})(root);
let bad = 0;
for (const f of files) {
  const rel = path.relative(root, f);
  const s = fs.readFileSync(f, 'utf8');
  const lines = s.split('\n');
  lines.forEach((line, i) => {
    for (const ch of line) {
      const c = ch.codePointAt(0);
      if ((c < 32 && c !== 9 && c !== 13) || c === 127 || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202f) || c === 0xfeff) {
        console.log(`제어문자 U+${c.toString(16).padStart(4, '0')}  ${rel}:${i + 1}`);
        bad++;
        break;
      }
    }
  });
  if (/\.(js|mjs)$/.test(f) && !rel.startsWith('data')) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      console.log('문법 오류', rel, String(e.stderr).split('\n').slice(0, 6).join(' | '));
      bad++;
    }
  }
}
console.log(bad ? `문제 ${bad}건` : `이상 없음 (${files.length}개 파일)`);
process.exit(bad ? 1 : 0);
