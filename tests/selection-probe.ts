import type { Page } from 'playwright';
/** 浏览器探针只读取真实上下文、投影和行边界，选择事件仍由真实输入触发。 */
export const VIEWPORT = '[class*="bom-table-MatchingTools_"],[class*="coordinate-container_"]';
export const PROBE = `(()=>{
const context=()=>{let element=document.querySelector('#smt-engine-canvas');while(element&&!Object.keys(element).some(key=>key.startsWith('__reactFiber$')))element=element.parentElement;let fiber=element?.[Object.keys(element).find(key=>key.startsWith('__reactFiber$'))];while(fiber){const value=fiber.memoizedProps?.value;if(value?.initFinished)return value;fiber=fiber.return;}};
const state=()=>{const value=context();return value?{ids:Object.keys(value.ids).filter(id=>value.ids[id]),active:value.engineLeftClickId,net:value.netlistSelectedId,revision:value.selectionRevision??0,names:Object.keys(value.ids).map(id=>value.uniqueIdIndex[id]?.Designator)}:null};
const point=id=>{const canvas=document.querySelector('#smt-engine-canvas').getBoundingClientRect();const model=window.__JLCFConv.geometry.inspect([id])[0];if(!model?.projected.length)return null;return{x:canvas.x+model.projected.reduce((sum,p)=>sum+p.x,0)/model.projected.length,y:canvas.y+model.projected.reduce((sum,p)=>sum+p.y,0)/model.projected.length,canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},kind:model.kind}};
const row=()=>{const value=state();const target=[...document.querySelectorAll('tr[data-jlcf-ids]')].find(row=>JSON.parse(row.dataset.jlcfIds).includes(value?.active));if(!target)return null;const viewport=target.closest('${VIEWPORT}');const bounds=target.getBoundingClientRect(),view=viewport.getBoundingClientRect(),header=viewport.querySelector('thead')?.getBoundingClientRect().height??0;return{top:bounds.top,bottom:bounds.bottom,left:bounds.left,right:bounds.right,viewTop:view.top+header,viewBottom:view.bottom,selected:target.dataset.jlcfSelected,visible:!!target.getClientRects().length&&bounds.top>=view.top+header-1&&bounds.bottom<=view.bottom+1}};
window.__selectionTest={context,state,point,row,picks:[],stable:{}};
window.__selectionTest.subscription=window._MSG_BUS_.subscribe('/engine/leftClick',id=>window.__selectionTest.picks.push(id));
})()`;
export interface State {
  ids: string[];
  active: string;
  net: string;
  revision: number;
  names: string[];
}
export interface Point {
  x: number;
  y: number;
  kind: string;
  canvas: { x: number; y: number; width: number; height: number };
}
export async function stablePoint(page: Page, id: string) {
  await page.evaluate((id) => {
    delete (window as any).__selectionTest.stable[id];
  }, id);
  await page.waitForFunction((id) => {
    const test = (window as any).__selectionTest,
      point = test.point(id);
    if (!point || point.x <= 0 || point.x >= innerWidth || point.y <= 0 || point.y >= innerHeight)
      return false;
    const last = test.stable[id];
    const count =
      last && Math.abs(last.x - point.x) < 0.05 && Math.abs(last.y - point.y) < 0.05
        ? last.count + 1
        : 0;
    test.stable[id] = { ...point, count };
    return count >= 4;
  }, id);
  return page.evaluate<Point>((id) => (window as any).__selectionTest.point(id), id);
}
