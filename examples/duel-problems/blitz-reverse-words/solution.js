// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
const w=text.trim().split(/\s+/);const out=[];
for(let i=w.length-1;i>=0;i--)out.push(w[i]);
console.log(out.join(' '));
