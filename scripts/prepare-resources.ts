import { prepareResources } from '../src/core/resources.js';
const sample = process.argv[2] ?? process.env.HTML_SAMPLE_FILE;
if (!sample) throw new Error('请传入用于识别引擎版本的 HTML 样本路径。');
console.log(JSON.stringify(await prepareResources(sample), null, 2));
