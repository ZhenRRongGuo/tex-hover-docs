export type MetadataKind = 'class' | 'theme';

export interface OptionMetadata {
	description: string;
	default?: string;
	values?: Record<string, string>;
}

export interface HoverMetadata {
	kind: MetadataKind;
	name: string;
	description: string;
	options: Record<string, OptionMetadata>;
}

export function parseMetadata(source: string): HoverMetadata | undefined {
	const lines = source.split(/\r?\n/);
	const begin = lines.findIndex((line) => /^\s*%\s*vscode-hover:begin\s*$/.test(line));
	if (begin < 0) {
		return undefined;
	}

	const end = lines.findIndex((line, index) => index > begin && /^\s*%\s*vscode-hover:end\s*$/.test(line));
	if (end < 0) {
		throw new Error('Missing % vscode-hover:end marker.');
	}

	const json = lines.slice(begin + 1, end).map((line) => {
		const comment = line.match(/^\s*% ?(.*)$/);
		if (!comment) {
			throw new Error('Every metadata line must be a LaTeX comment beginning with %.');
		}
		return comment[1];
	}).join('\n');
	const value: unknown = JSON.parse(removeTrailingCommas(json));
	if (!isRecord(value) || (value.kind !== 'class' && value.kind !== 'theme') ||
		typeof value.name !== 'string' || typeof value.description !== 'string') {
		throw new Error('Metadata requires kind, name, and description fields.');
	}

	const options: Record<string, OptionMetadata> = {};
	if (value.options !== undefined) {
		if (!isRecord(value.options)) {
			throw new Error('The options field must be an object.');
		}
		for (const [key, option] of Object.entries(value.options)) {
			if (!isRecord(option) || typeof option.description !== 'string') {
				throw new Error(`Option "${key}" requires a description.`);
			}
			if (option.default !== undefined && typeof option.default !== 'string') {
				throw new Error(`The default for option "${key}" must be a string.`);
			}
			if (option.values !== undefined && (!isRecord(option.values) ||
				Object.values(option.values).some((description) => typeof description !== 'string'))) {
				throw new Error(`Values for option "${key}" must map strings to descriptions.`);
			}
			options[key] = {
				description: option.description,
				...(typeof option.default === 'string' ? { default: option.default } : {}),
				...(isRecord(option.values) ? { values: option.values as Record<string, string> } : {}),
			};
		}
	}

	return {
		kind: value.kind,
		name: value.name,
		description: value.description,
		options,
	};
}

function removeTrailingCommas(source: string): string {
	let result = '';
	let inString = false;
	let escaped = false;
	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (inString) {
			result += character;
			if (escaped) {
				escaped = false;
			} else if (character === '\\') {
				escaped = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}
		if (character === '"') {
			inString = true;
			result += character;
			continue;
		}
		if (character === ',') {
			let next = index + 1;
			while (/\s/.test(source[next] ?? '')) {
				next++;
			}
			if (source[next] === '}' || source[next] === ']') {
				continue;
			}
		}
		result += character;
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
