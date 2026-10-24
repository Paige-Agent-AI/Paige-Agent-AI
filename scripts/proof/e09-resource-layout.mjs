/** Browser-side WCAG text measurement for the existing resource proof capsules. */
export function inspectResourceContrast(selector){
 const root=document.querySelector(selector);if(!root)throw Error('Resource surface missing');
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
 const color=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data).map((v,i)=>i===3?v/255:v);};
 const over=(front,back)=>front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3])).concat(1);
 const luminance=rgb=>rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const measurements=[];
 for(const node of root.querySelectorAll('p,h1,h2,h3,h4,dt,dd,label,button,input,summary,a,article>div')){
  if(!node.getClientRects().length||node.matches(':disabled')||node.closest('[hidden],[inert]'))continue;
  const isPlaceholder=node instanceof HTMLInputElement&&!node.value&&node.placeholder;
  const text=isPlaceholder?node.placeholder:node.textContent?.trim();if(!text)continue;
  const style=getComputedStyle(node),foreground=getComputedStyle(node,isPlaceholder?'::placeholder':null);
  let background=[255,255,255,1];const ancestors=[];for(let parent=node;parent;parent=parent.parentElement)ancestors.unshift(parent);
  for(const parent of ancestors)background=over(color(getComputedStyle(parent).backgroundColor),background);
  const ink=over(color(foreground.color),background),a=luminance(ink),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&parseInt(style.fontWeight)>=700),required=large?3:4.5;
  measurements.push({tag:node.tagName,text:text.slice(0,64),foreground:foreground.color,background:background.slice(0,3),ratio,required,pass:ratio+.001>=required});
 }
 return {measured:measurements.length,minimum:Math.min(...measurements.map(v=>v.ratio)),failures:measurements.filter(v=>!v.pass),measurements};
}
