// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
const n=Number(text.trim()),sieve=new Uint8Array(n+1);let count=0;
for(let i=2;i<=n;i++){if(sieve[i])continue;count++;for(let j=i*i;j<=n;j+=i)sieve[j]=1;}
console.log(count);
