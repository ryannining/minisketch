// Regression: booleans must be winding-agnostic end to end.
global.window={}; require('/home/ryan/git/minisketch/tools/path-bool.js');
const PB=global.window.PathBool;
const C=require('/home/ryan/git/minisketch/core.js');
const shoelace=q=>{let a=0;for(let i=0;i<q.length;i++){const p=q[i],r=q[(i+1)%q.length];a+=p.x*r.y-r.x*p.y;}return a/2;};
function blob(cx,cy,r,cw){const n=8,pts=[];
  for(let i=0;i<n;i++){const a=-i*2*Math.PI/n*(cw?1:-1);pts.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r});}
  return pts;}
function emit(p){const o=[['M',[p[0].x,p[0].y]]];
  for(let i=1;i<p.length;i++)o.push(['L',[p[i].x,p[i].y]]);
  o.push(['Z']);return o;}
const toIn=p=>({path:[...PB.pathFromCommands(emit(p))],fillRule:PB.FillRule.NonZero});
const areaOf=paths=>paths.reduce((t,pth)=>{const pts=[];
  for(const seg of pth){if(!pts.length)pts.push({x:seg[1][0],y:seg[1][1]});
    for(let i=1;i<=16;i++){const q=PB.samplePathSegmentAt(seg,i/16);pts.push({x:q[0],y:q[1]});}}
  return t+Math.abs(shoelace(pts));},0);

let fails=0;
for (const [n1,c1] of [['CCW',false],['CW',true]])
for (const [n2,c2] of [['CCW',false],['CW',true]])
for (const [n3,c3] of [['CCW',false],['CW',true]]) {
  const A=blob(0,0,10,c1), B=blob(8,0,10,c2), D=blob(16,0,10,c3);
  const s1=new PB.PathBoolean([toIn(A),toIn(B)]).get(PB.PathBooleanOperation.Union);
  const s2=new PB.PathBoolean([...s1.map(p=>({path:[...p],fillRule:PB.FillRule.NonZero})),toIn(D)]).get(PB.PathBooleanOperation.Union);
  const a1=areaOf(s1), a2=areaOf(s2);
  const ok = s1.length===1 && s2.length===1 && Math.abs(a2-576.3)<1;
  if(!ok) fails++;
  console.log((ok?'PASS':'FAIL')+'  A='+n1+' B='+n2+' C='+n3+
    '  op1='+s1.length+'p/'+a1.toFixed(1)+'  op2='+s2.length+'p/'+a2.toFixed(1));
}
console.log('\nreference union of 3 octagons r=10 at x=0,8,16 = 576.3 (2000x2000 grid)');
console.log(fails? fails+' FAILED' : 'all winding combinations consistent');
process.exit(fails?1:0);
