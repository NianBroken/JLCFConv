import traverseImport from '@babel/traverse';

/** Babel 的模块入口在 ESM 和打包环境下统一为带类型的遍历函数。 */
export const traverse =
  typeof traverseImport === 'function'
    ? traverseImport
    : (traverseImport as unknown as { default: typeof traverseImport }).default;
