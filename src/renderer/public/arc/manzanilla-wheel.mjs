export const modes = [
  ['Agents','team','team'], ['Dani','desk','overview'],
  ['Workspace','tasks','overview'], ['Control Center','desk','overview'],
  ['Open Dani','plus','overview'], ['Agents','team','team'],
  ['Dani','desk','overview'],
  ['Themes','palette','themes'],
];
export const turn = (selected, direction) => (selected + Math.sign(direction) + modes.length) % modes.length;
export const visibleModes = selected => [2,1,0,-1].map(offset => (selected + offset + modes.length) % modes.length);
// All eight sectors are real, including those beyond the screen edge.
export const dialModes = selected => Array.from({length:modes.length},(_,i)=>(selected+2-i+modes.length)%modes.length);

// A physical chord owns one capture. Browsing can never submit its abandoned speech.
export class ArcSession {
  held=false; browsing=false; hasAgents=false;
  hold(hasAgents){this.held=true;this.browsing=false;this.hasAgents=hasAgents;}
  get canListen(){return this.held&&!this.browsing&&this.hasAgents;}
  scroll(){this.browsing=true;}
  release(){const finish=this.canListen;this.held=false;return finish;}
}
