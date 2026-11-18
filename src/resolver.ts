import { execFile } from 'child_process';
import { promisify } from 'util';

export type WorkspaceSearch = (fileName: string) => Promise<string | undefined>;
export type KpsewhichRunner = (executable: string, args: string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

export async function resolveDefinitionPath(
	fileName: string,
	executable: string,
	searchWorkspace: WorkspaceSearch,
	runKpsewhich: KpsewhichRunner = defaultKpsewhichRunner,
): Promise<string | undefined> {
	const workspacePath = await searchWorkspace(fileName);
	if (workspacePath) {
		return workspacePath;
	}

	const stdout = await runKpsewhich(executable, [fileName]);
	return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

async function defaultKpsewhichRunner(executable: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync(executable, args, {
		encoding: 'utf8',
		windowsHide: true,
		timeout: 5000,
		maxBuffer: 1024 * 1024,
	});
	return stdout;
}
