// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
const t=text.trim().split(/\s+/).map(Number),n=t[0],k=t[1]%n,a=t.slice(2),r=Array(n);
a.forEach((x,i)=>{r[(i+k)%n]=x;});
console.log(r.join(' '));
