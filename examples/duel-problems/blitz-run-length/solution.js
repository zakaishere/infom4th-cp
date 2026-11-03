// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
const s=text.trim();let out='',count=1;
for(let i=1;i<=s.length;i++){if(s[i]===s[i-1])count++;else{out+=s[i-1]+count;count=1;}}
console.log(out);
