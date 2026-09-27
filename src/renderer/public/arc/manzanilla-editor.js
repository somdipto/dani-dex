import { DEFAULT_DIAL_LAYOUT, DIAL_ZOOM, normalizeDialLayout } from './manzanilla-layout.mjs';
import { arcLayout } from './manzanilla-geometry.mjs';

export function createDialEditor({ onStart, onPreview, onFinish }) {
  let active = false, draft, original, drag = null;
  const host = document.createElement('section');
  host.id = 'dial-editor'; host.hidden = true;
  host.setAttribute('aria-label', 'Edit dial');
  host.innerHTML = `<div class="edit-shield"></div>
    <div class="edit-guide" aria-hidden="true"></div>
    <button class="edit-center" aria-label="Move dial center" title="Drag to move the dial center">✥</button>
    <button class="edit-resize" aria-label="Resize dial" title="Drag to resize">↔</button>
    <section class="edit-toolbar" aria-label="Dial editing controls">
      <div><strong>Edit dial</strong><span class="edit-hint">Pinned open · drag the center or size handle</span></div>
      <label class="edit-size">Size <input aria-label="Dial size" type="range" min="60" max="160" step="1" value="100"><output>100%</output></label>
      <div class="edit-buttons"><button data-edit="reset">Reset</button><button data-edit="cancel">Cancel</button><button data-edit="done">Done</button></div>
    </section>`;
  document.body.append(host);
  const center = host.querySelector('.edit-center'), resize = host.querySelector('.edit-resize');
  const guide = host.querySelector('.edit-guide'), slider = host.querySelector('input'), output = host.querySelector('output');
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  function paint() {
    if (!active) return;
    const layout = arcLayout(innerWidth,innerHeight,1,draft), radius = 260 * layout.scale;
    const x = draft.centerX * innerWidth, y = draft.centerY * innerHeight;
    center.style.left = `${clamp(x,26,innerWidth-26)}px`;
    center.style.top = `${clamp(y,26,innerHeight-26)}px`;
    // Point the resize handle towards the available interior, never off-screen.
    const angle = Math.atan2(innerHeight/2-y,innerWidth/2-x);
    resize.style.left = `${clamp(x+Math.cos(angle)*radius,24,innerWidth-24)}px`;
    resize.style.top = `${clamp(y+Math.sin(angle)*radius,24,innerHeight-24)}px`;
    Object.assign(guide.style,{left:`${x-radius}px`,top:`${y-radius}px`,width:`${radius*2}px`,height:`${radius*2}px`});
    slider.value = String(Math.round(draft.zoom*100)); output.value = `${Math.round(draft.zoom*100)}%`;
    center.setAttribute('aria-description',`Center ${Math.round(x)}, ${Math.round(y)}. Use arrow keys to move, Shift for larger steps.`);
    onPreview({...draft});
  }
  function open(layout) {
    if (active) return;
    original = normalizeDialLayout(layout); draft = {...original}; active = true;
    host.hidden = false; document.body.classList.add('editing');
    onStart(); paint(); center.focus({preventScroll:true});
  }
  function finish(save) {
    if (!active) return;
    if (drag) { const control=drag.control; const id=drag.id; drag=null; if(control.hasPointerCapture(id))control.releasePointerCapture(id); }
    active=false;host.hidden=true;document.body.classList.remove('editing');
    onFinish(save,save?{...draft}:{...original});
  }
  function begin(event,type) {
    if (!active || event.button!==0) return;
    event.preventDefault();
    const control=event.currentTarget;
    const x=draft.centerX*innerWidth,y=draft.centerY*innerHeight;
    drag={type,control,id:event.pointerId,startX:event.clientX,startY:event.clientY,start:{...draft},distance:Math.hypot(event.clientX-x,event.clientY-y)};
    control.setPointerCapture(event.pointerId);
  }
  function move(event) {
    if (!active||!drag||event.pointerId!==drag.id) return;
    if(drag.type==='move')draft=normalizeDialLayout({...draft,centerX:drag.start.centerX+(event.clientX-drag.startX)/innerWidth,centerY:drag.start.centerY+(event.clientY-drag.startY)/innerHeight});
    else {
      const x=draft.centerX*innerWidth,y=draft.centerY*innerHeight;
      const baseScale=arcLayout(innerWidth,innerHeight,1,{...draft,zoom:1}).scale;
      draft=normalizeDialLayout({...draft,zoom:drag.start.zoom+(Math.hypot(event.clientX-x,event.clientY-y)-drag.distance)/(260*baseScale)});
    }
    paint();
  }
  for(const [control,type] of [[center,'move'],[resize,'size']]) {
    control.addEventListener('pointerdown',e=>begin(e,type));control.addEventListener('pointermove',move);
    control.addEventListener('pointerup',e=>{if(drag?.id===e.pointerId){drag=null;if(control.hasPointerCapture(e.pointerId))control.releasePointerCapture(e.pointerId);}});
    control.addEventListener('pointercancel',()=>{if(drag){draft={...drag.start};drag=null;paint();}});
    control.addEventListener('lostpointercapture',()=>{drag=null;});
    control.addEventListener('keydown',e=>{
      const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!active||!dirs[e.key])return;e.preventDefault();
      if(type==='move'){const step=e.shiftKey?10:1;draft=normalizeDialLayout({...draft,centerX:draft.centerX+dirs[e.key][0]*step/innerWidth,centerY:draft.centerY+dirs[e.key][1]*step/innerHeight});}
      else draft=normalizeDialLayout({...draft,zoom:draft.zoom+(dirs[e.key][0]||-dirs[e.key][1])*(e.shiftKey?.1:.01)});
      paint();
    });
  }
  slider.addEventListener('input',()=>{draft=normalizeDialLayout({...draft,zoom:Number(slider.value)/100});paint();});
  host.querySelector('[data-edit="reset"]').addEventListener('click',()=>{draft={...DEFAULT_DIAL_LAYOUT};paint();});
  host.querySelector('[data-edit="cancel"]').addEventListener('click',()=>finish(false));
  host.querySelector('[data-edit="done"]').addEventListener('click',()=>finish(true));
  document.addEventListener('keydown',e=>{
    if(!active)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish(false);}
    if(e.key==='Tab'){const controls=[center,resize,slider,...host.querySelectorAll('.edit-buttons button')],index=controls.indexOf(document.activeElement);e.preventDefault();controls[(index+(e.shiftKey?-1:1)+controls.length)%controls.length].focus();}
  },true);
  window.addEventListener('resize',paint);
  return {open,finish,get active(){return active;},get layout(){return draft;},limits:DIAL_ZOOM};
}
