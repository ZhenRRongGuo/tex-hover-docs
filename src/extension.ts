import * as vscode from 'vscode';
import { HoverMetadata, parseMetadata } from './metadata';
import { resolveDefinitionPath } from './resolver';
import { findHoverTarget } from './texScanner';

const definitionCache = new Map<string, vscode.Uri | null>();

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('TeX Hover Docs');
	context.subscriptions.push(output);

	const provider = vscode.languages.registerHoverProvider(
		[{ language: 'latex' }, { language: 'tex' }],
		{
			provideHover: async (document, position) => {
				const target = findHoverTarget(document.getText(), document.offsetAt(position));
				if (!target) {
					return undefined;
				}

				const metadata = await loadMetadata(target.kind, target.name, output);
				if (!metadata) {
					return undefined;
				}

				const contents = renderHover(metadata, target);
				if (contents.length === 0) {
					return undefined;
				}
				const span = target.valueSpan ?? target.optionSpan ?? target.nameSpan;
				return new vscode.Hover(contents, new vscode.Range(
					document.positionAt(span.start),
					document.positionAt(span.end),
				));
			},
		},
	);
	context.subscriptions.push(provider);

	const watcher = vscode.workspace.createFileSystemWatcher('**/*.{cls,sty}');
	context.subscriptions.push(
		watcher,
		watcher.onDidChange(clearDefinitionCache),
		watcher.onDidCreate(clearDefinitionCache),
		watcher.onDidDelete(clearDefinitionCache),
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (/\.(cls|sty)$/i.test(event.document.uri.path)) {
				clearDefinitionCache();
			}
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('texHoverDocs.kpsewhichPath')) {
				clearDefinitionCache();
			}
		}),
	);
}

export function deactivate(): void {
	definitionCache.clear();
}

async function loadMetadata(
	kind: 'class' | 'theme',
	name: string,
	output: vscode.OutputChannel,
): Promise<HoverMetadata | undefined> {
	const fileName = kind === 'class' ? `${name}.cls` : `beamertheme${name}.sty`;
	let uri = definitionCache.get(fileName);
	if (uri === undefined) {
		uri = await findDefinition(fileName, output);
		definitionCache.set(fileName, uri ?? null);
	}
	if (!uri) {
		return undefined;
	}

	const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri?.toString());
	try {
		const source = openDocument
			? openDocument.getText()
			: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
		const metadata = parseMetadata(source);
		if (!metadata || metadata.kind !== kind || metadata.name !== name) {
			return undefined;
		}
		return metadata;
	} catch (error) {
		output.appendLine(`Could not read hover metadata from ${uri.fsPath}: ${String(error)}`);
		return undefined;
	}
}

async function findDefinition(fileName: string, output: vscode.OutputChannel): Promise<vscode.Uri | undefined> {
	const configuredPath = vscode.workspace.getConfiguration('texHoverDocs').get<string>('kpsewhichPath', 'kpsewhich');
	const executable = configuredPath.trim() || 'kpsewhich';
	try {
		const path = await resolveDefinitionPath(fileName, executable, findWorkspacePath);
		return path ? vscode.Uri.file(path) : undefined;
	} catch (error) {
		output.appendLine(`Could not resolve ${fileName} using kpsewhich "${executable}": ${String(error)}`);
		return undefined;
	}
}

async function findWorkspacePath(fileName: string): Promise<string | undefined> {
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const matches = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, `**/${fileName}`),
			'**/{.git,node_modules}/**',
			1,
		);
		if (matches.length > 0) {
			return matches[0].fsPath;
		}
	}
	return undefined;
}

export function renderHover(metadata: HoverMetadata, target: NonNullable<ReturnType<typeof findHoverTarget>>): vscode.MarkdownString[] {
	const markdown = new vscode.MarkdownString();
	markdown.isTrusted = false;
	if (!target.option) {
		markdown.appendMarkdown(`**${metadata.kind === 'class' ? 'LaTeX class' : 'Beamer theme'}: `);
		markdown.appendText(metadata.name);
		markdown.appendMarkdown('**\n\n');
		markdown.appendText(metadata.description);
		const options = Object.entries(metadata.options);
		if (options.length > 0) {
			markdown.appendMarkdown('\n\n**Options:**\n\n');
			for (const [name, option] of options) {
				markdown.appendMarkdown('- ');
				markdown.appendText(name);
				markdown.appendMarkdown(' - ');
				markdown.appendText(option.description);
				markdown.appendMarkdown('\n');
			}
		}
		return [markdown];
	}

	const option = metadata.options[target.option];
	if (!option) {
		return [];
	}
	markdown.appendMarkdown('**');
	markdown.appendText(target.option);
	markdown.appendMarkdown('**\n\n');
	markdown.appendText(option.description);
	if (option.default !== undefined) {
		markdown.appendMarkdown('\n\n**Default:** ');
		markdown.appendText(option.default);
	}

	if (target.value !== undefined) {
		const valueDescription = option.values?.[target.value];
		markdown.appendMarkdown('\n\n**Current value:** ');
		markdown.appendText(target.value);
		if (valueDescription !== undefined) {
			markdown.appendMarkdown('\n\n');
			markdown.appendText(valueDescription);
		} else if (option.values) {
			markdown.appendMarkdown('\n\nThis value has no additional description in the metadata.');
		}
	} else if (option.values && Object.keys(option.values).length > 0) {
		markdown.appendMarkdown('\n\n**Values:**');
		for (const [value, description] of Object.entries(option.values)) {
			markdown.appendMarkdown('\n\n- ');
			markdown.appendText(value);
			markdown.appendMarkdown(' - ');
			markdown.appendText(description);
		}
	}
	return [markdown];
}

function clearDefinitionCache(): void {
	definitionCache.clear();
}
