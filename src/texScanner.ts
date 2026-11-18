export type TargetKind = 'class' | 'theme';

export interface TextSpan {
	start: number;
	end: number;
}

export interface HoverTarget {
	kind: TargetKind;
	name: string;
	nameSpan: TextSpan;
	option?: string;
	optionSpan?: TextSpan;
	value?: string;
	valueSpan?: TextSpan;
}

interface ParsedOption {
	key: string;
	keySpan: TextSpan;
	value?: string;
	valueSpan?: TextSpan;
}

export function findHoverTarget(source: string, offset: number): HoverTarget | undefined {
	const clean = stripComments(source);
	const commandPattern = /\\(documentclass|usetheme)(?![A-Za-z@])/g;
	let command: RegExpExecArray | null;
	while ((command = commandPattern.exec(clean)) !== null) {
		if (precedingBackslashCount(clean, command.index) % 2 === 1) {
			continue;
		}
		const kind: TargetKind = command[1] === 'documentclass' ? 'class' : 'theme';
		let cursor = skipWhitespace(clean, command.index + command[0].length);
		if (clean[cursor] === '*') {
			cursor = skipWhitespace(clean, cursor + 1);
		}

		let optionGroup: TextSpan | undefined;
		if (clean[cursor] === '[') {
			optionGroup = readGroup(clean, cursor, '[', ']');
			if (!optionGroup) {
				continue;
			}
			cursor = skipWhitespace(clean, optionGroup.end);
		}

		if (clean[cursor] !== '{') {
			continue;
		}
		const nameGroup = readGroup(clean, cursor, '{', '}');
		if (!nameGroup) {
			continue;
		}
		const nameSpan = trimSpan(clean, { start: nameGroup.start + 1, end: nameGroup.end - 1 });
		const name = clean.slice(nameSpan.start, nameSpan.end);
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
			continue;
		}

		if (contains(nameSpan, offset)) {
			return { kind, name, nameSpan };
		}
		if (!optionGroup) {
			continue;
		}

		for (const option of parseOptions(clean, optionGroup)) {
			if (contains(option.keySpan, offset)) {
				return { kind, name, nameSpan, option: option.key, optionSpan: option.keySpan };
			}
			if (option.valueSpan && contains(option.valueSpan, offset)) {
				return {
					kind,
					name,
					nameSpan,
					option: option.key,
					optionSpan: option.keySpan,
					value: option.value,
					valueSpan: option.valueSpan,
				};
			}
		}
	}
	return undefined;
}

function stripComments(source: string): string {
	const characters = source.split('');
	for (let index = 0; index < characters.length; index++) {
		if (characters[index] !== '%' || precedingBackslashCount(source, index) % 2 === 1) {
			continue;
		}
		while (index < characters.length && characters[index] !== '\n' && characters[index] !== '\r') {
			characters[index] = ' ';
			index++;
		}
	}
	return characters.join('');
}

function precedingBackslashCount(source: string, offset: number): number {
	let count = 0;
	for (let index = offset - 1; index >= 0 && source[index] === '\\'; index--) {
		count++;
	}
	return count;
}

function skipWhitespace(source: string, offset: number): number {
	while (/\s/.test(source[offset] ?? '')) {
		offset++;
	}
	return offset;
}

function readGroup(source: string, start: number, open: '[' | '{', close: ']' | '}'): TextSpan | undefined {
	const stack: Array<'[' | '{'> = [open];
	for (let index = start + 1; index < source.length; index++) {
		const character = source[index];
		if (precedingBackslashCount(source, index) % 2 === 1) {
			continue;
		}
		if (character === '[' || character === '{') {
			stack.push(character);
		} else if (character === ']' || character === '}') {
			const expected = character === ']' ? '[' : '{';
			if (stack[stack.length - 1] === expected) {
				stack.pop();
				if (stack.length === 0) {
					return { start, end: index + 1 };
				}
			}
		}
	}
	return undefined;
}

function parseOptions(source: string, group: TextSpan): ParsedOption[] {
	const contentStart = group.start + 1;
	const contentEnd = group.end - 1;
	const result: ParsedOption[] = [];
	let segmentStart = contentStart;
	let braces = 0;
	let brackets = 0;
	for (let index = contentStart; index <= contentEnd; index++) {
		const character = source[index];
		if (index === contentEnd || (character === ',' && braces === 0 && brackets === 0 &&
			precedingBackslashCount(source, index) % 2 === 0)) {
			const option = parseOption(source, { start: segmentStart, end: index });
			if (option) {
				result.push(option);
			}
			segmentStart = index + 1;
			continue;
		}
		if (precedingBackslashCount(source, index) % 2 === 1) {
			continue;
		}
		if (character === '{') { braces++; }
		if (character === '}' && braces > 0) { braces--; }
		if (character === '[') { brackets++; }
		if (character === ']' && brackets > 0) { brackets--; }
	}
	return result;
}

function parseOption(source: string, segment: TextSpan): ParsedOption | undefined {
	const trimmed = trimSpan(source, segment);
	if (trimmed.start >= trimmed.end) {
		return undefined;
	}
	let braces = 0;
	let brackets = 0;
	let equals = -1;
	for (let index = trimmed.start; index < trimmed.end; index++) {
		const character = source[index];
		if (precedingBackslashCount(source, index) % 2 === 1) {
			continue;
		}
		if (character === '{') { braces++; }
		if (character === '}' && braces > 0) { braces--; }
		if (character === '[') { brackets++; }
		if (character === ']' && brackets > 0) { brackets--; }
		if (character === '=' && braces === 0 && brackets === 0) {
			equals = index;
			break;
		}
	}
	const keySpan = trimSpan(source, { start: trimmed.start, end: equals < 0 ? trimmed.end : equals });
	if (keySpan.start >= keySpan.end) {
		return undefined;
	}
	const key = source.slice(keySpan.start, keySpan.end);
	if (equals < 0) {
		return { key, keySpan };
	}
	let valueSpan = trimSpan(source, { start: equals + 1, end: trimmed.end });
	if (source[valueSpan.start] === '{' && source[valueSpan.end - 1] === '}') {
		valueSpan = trimSpan(source, { start: valueSpan.start + 1, end: valueSpan.end - 1 });
	}
	return { key, keySpan, value: source.slice(valueSpan.start, valueSpan.end), valueSpan };
}

function trimSpan(source: string, span: TextSpan): TextSpan {
	let { start, end } = span;
	while (start < end && /\s/.test(source[start])) { start++; }
	while (end > start && /\s/.test(source[end - 1])) { end--; }
	return { start, end };
}

function contains(span: TextSpan, offset: number): boolean {
	return offset >= span.start && offset < span.end;
}
