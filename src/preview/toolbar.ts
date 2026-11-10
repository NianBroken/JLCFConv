/** 模型操作栏遵循实际视口尺寸，桌面与手机使用相同排列规则。 */
export const toolbarStyles = `
[class*="smt-preview-header-nav-bar_"]{display:flex!important;align-items:center;flex-wrap:wrap;gap:2px;padding:0!important;margin:0!important;min-width:0!important;width:auto!important;height:auto!important;flex:0 1 auto;list-style:none}[class*="smt-preview-header-nav-bar_"]>[class*="nav-bar-item_"]{flex:none;width:32px!important;height:32px!important;display:flex;align-items:center;justify-content:center;border-radius:5px}[class*="radioArea_column_"]>[class*="smt-preview-header-nav-bar_"]{border-top:1px solid #e4eaf1;padding-top:8px!important;margin-top:4px!important;max-width:100%}
`;
