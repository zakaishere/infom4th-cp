// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
const a=text.trim().split(/\s+/).slice(1).map(Number);let best=0;
for(let i=0;i<a.length;){let j=i;while(j<a.length&&a[j]===a[i])j++;best=Math.max(best,j-i);i=j;}
console.log(best);
