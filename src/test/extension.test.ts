import * as assert from 'assert';
import { renderHover } from '../extension';
import { parseMetadata } from '../metadata';
import { resolveDefinitionPath } from '../resolver';
import { findHoverTarget } from '../texScanner';

suite('Definition resolver', () => {
	test('uses a workspace file before calling kpsewhich', async () => {
		const resolved = await resolveDefinitionPath(
			'Manuscript.cls',
			'kpsewhich',
			async () => 'C:\\project\\Manuscript.cls',
			async () => { throw new Error('kpsewhich should not run'); },
		);
		assert.strictEqual(resolved, 'C:\\project\\Manuscript.cls');
	});

	test('calls kpsewhich with the exact filename when workspace search misses', async () => {
		let command = '';
		let args: string[] = [];
		const resolved = await resolveDefinitionPath(
			'Manuscript.cls',
			'C:\\TeX Live\\bin\\windows\\kpsewhich.exe',
			async () => undefined,
			async (executable, commandArgs) => {
				command = executable;
				args = commandArgs;
				return 'D:/texmf-local/Manuscript.cls\r\n';
			},
		);
		assert.strictEqual(command, 'C:\\TeX Live\\bin\\windows\\kpsewhich.exe');
		assert.deepStrictEqual(args, ['Manuscript.cls']);
		assert.strictEqual(resolved, 'D:/texmf-local/Manuscript.cls');
	});

	test('returns undefined when kpsewhich finds no file', async () => {
		const resolved = await resolveDefinitionPath(
			'Unknown.cls',
			'kpsewhich',
			async () => undefined,
			async () => '\r\n',
		);
		assert.strictEqual(resolved, undefined);
	});
});

suite('Metadata parser', () => {
	test('reads the JSON comment block from a definition file', () => {
		const source = `% vscode-hover:begin
% {
%   "kind": "class",
%   "name": "TestCls",
%   "description": "Test class.",
%   "options": {
%     "lang": {
%       "description": "Document language.",
%       "default": "zh",
%       "values": { "zh": "Chinese", "en": "English" }
%     },
%     "columns": {
%       "description": "Single or double column layout."
%     }
%   }
% }
% vscode-hover:end`;
		const metadata = parseMetadata(source);
		assert.strictEqual(metadata?.kind, 'class');
		assert.strictEqual(metadata?.options.lang.default, 'zh');
		assert.strictEqual(metadata?.options.lang.values?.en, 'English');
	});

	test('accepts trailing commas without changing commas inside strings', () => {
		const source = `% vscode-hover:begin
% {
%   "kind": "class",
%   "name": "Manuscript",
%   "description": "A template, for papers",
%   "options": {
%     "zh": {
%       "description": "Document language.",
%       "values": {
%         "zh": "Supports Chinese",
%       },
%     },
%     "linenum": {
%       "description": "Line number display",
%       "default": "none",
%       "values": {
%         "none": "No line numbers",
%         "text": "Text only, with commas, preserved",
%         "all": "All content",
%       },
%     },
%   },
% }
% vscode-hover:end`;
		const metadata = parseMetadata(source);
		assert.strictEqual(metadata?.name, 'Manuscript');
		assert.strictEqual(metadata?.options.linenum.values?.text, 'Text only, with commas, preserved');
		assert.strictEqual(metadata?.options.linenum.values?.all, 'All content');
	});

	test('shows documented options in the class name hover', () => {
		const metadata = parseMetadata(`% vscode-hover:begin
% {
%   "kind": "class",
%   "name": "TestCls",
%   "description": "Test class.",
%   "options": {
%     "lang": { "description": "Document language." },
%     "columns": { "description": "Single or double column layout." }
%   }
% }
% vscode-hover:end`);
		assert.ok(metadata);
		const source = '\\documentclass{TestCls}';
		const target = findHoverTarget(source, source.indexOf('TestCls'));
		assert.ok(target);
		const rendered = renderHover(metadata, target)[0].value;
		const plainText = rendered.replace(/&nbsp;/g, ' ');
		assert.ok(plainText.includes('**Options:**'));
		assert.ok(plainText.includes('lang - Document language.'));
		assert.ok(plainText.includes('columns - Single or double column layout.'));
	});

	test('rejects malformed metadata JSON', () => {
		assert.throws(() => parseMetadata('% vscode-hover:begin\n% {\n% vscode-hover:end'));
	});
});

suite('TeX hover target scanner', () => {
	test('finds names, keys, and values in multiline commands while ignoring comments', () => {
		const source = `% \\documentclass{Ignored}
\\documentclass[
  lang=zh,
  draft
]{TestCls}
\\usetheme[lang={en}]{TestBeamer}`;

		assert.strictEqual(findHoverTarget(source, source.indexOf('Ignored')), undefined);
		assert.strictEqual(findHoverTarget(source, source.indexOf('TestCls'))?.name, 'TestCls');
		assert.strictEqual(findHoverTarget(source, source.indexOf('lang=zh'))?.option, 'lang');
		assert.strictEqual(findHoverTarget(source, source.indexOf('zh'))?.value, 'zh');
		assert.strictEqual(findHoverTarget(source, source.indexOf('draft'))?.option, 'draft');
		const themeValue = source.lastIndexOf('en');
		assert.strictEqual(findHoverTarget(source, themeValue)?.value, 'en');
		const manuscript = '\\documentclass[linenum=none]{Manuscript}';
		assert.strictEqual(findHoverTarget(manuscript, manuscript.indexOf('none'))?.value, 'none');
	});
});
