import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';

let tempDir: string | undefined;

interface GitHubRepository {
    full_name: string;
    clone_url: string;
}

// define fetch globally
declare const fetch: any;

export function activate(context: vscode.ExtensionContext) {
    // If this window is already showing a temp clone, track it for cleanup on close.
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        const wsPath = workspaceFolder.uri.fsPath;
        const tmpdir = os.tmpdir();
        if (wsPath.startsWith(tmpdir) && wsPath.includes('-vscode-clone-')) {
            tempDir = wsPath;
        }
    }

    let disposable = vscode.commands.registerCommand('extension.cloneTempRepo', async () => {
        const options = ['Select a repository from GitHub', 'Enter Git repository URL manually'];
        const choice = await vscode.window.showQuickPick(options, {
            placeHolder: 'How would you like to provide the repository URL?',
        });

        let repoUrl: string | undefined;

        if (choice === options[1]) {
            // Option 1: Enter Git repository URL manually
            repoUrl = await vscode.window.showInputBox({
                placeHolder: 'Enter Git repository URL',
            });
            if (!repoUrl) {
                vscode.window.showErrorMessage('Repository URL is required');
                return;
            }
            await handleClone(repoUrl);
        } else if (choice === options[0]) {
            // Option 2: Select a repository from GitHub
            const githubApi = vscode.extensions.getExtension('GitHub.vscode-pull-request-github');
            if (!githubApi) {
                vscode.window.showErrorMessage('GitHub Pull Requests and Issues extension is not installed or enabled.');
                return;
            }

            const api = await githubApi.activate();
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });

            if (!session) {
                vscode.window.showErrorMessage('GitHub authentication failed.');
                return;
            }

            const headers = { Authorization: `Bearer ${session.accessToken}` };

            const quickPick = vscode.window.createQuickPick();
            quickPick.placeholder = 'Search for a repository (e.g., microsoft/vscode)';
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;

            let timeout: NodeJS.Timeout | undefined;

            quickPick.onDidChangeValue((value) => {
                if (timeout) {
                    clearTimeout(timeout);
                }

                timeout = setTimeout(async () => {
                    if (!value) {
                        quickPick.items = [];
                        return;
                    }

                    const apiUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(value)}`;
                    try {
                        const response = await fetch(apiUrl, { headers });

                        if (!response.ok) {
                            vscode.window.showErrorMessage('Failed to fetch repositories from GitHub.');
                            quickPick.items = [];
                            return;
                        }

                        const data = (await response.json()) as { items: GitHubRepository[] };
                        quickPick.items = data.items.map((repo) => ({
                            label: repo.full_name,
                            description: repo.clone_url,
                        }));
                    } catch (error) {
                        vscode.window.showErrorMessage('An error occurred while fetching repositories.');
                        quickPick.items = [];
                    }
                }, 300); // Debounce for 500ms
            });

            quickPick.onDidAccept(async () => {
                const selectedItem = quickPick.selectedItems[0];
                if (selectedItem) {
                    repoUrl = selectedItem.description; // Use the clone URL
                    console.log(`Selected repository URL: ${repoUrl}`);
                    quickPick.hide();
                    await handleClone(repoUrl!);
                } else {
                    console.log('No repository selected.');
                }
            });

            quickPick.onDidHide(() => {
                quickPick.dispose();
            });

            quickPick.show();
        }
    });

    context.subscriptions.push(disposable);
}

async function handleClone(repoUrl: string) {
    const repoName = getRepoNameFromUrl(repoUrl);
    if (!repoName) {
        vscode.window.showErrorMessage('Invalid repository URL');
        console.error('Invalid repository URL:', repoUrl);
        return;
    }

    console.log(`Repository name: ${repoName}`);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${repoName}-vscode-clone-`));
    console.log(`Temporary directory created: ${tempDir}`);

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Cloning Repository",
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 0 });
        try {
            console.log(`Cloning repository from ${repoUrl} to ${tempDir}`);
            await cloneRepo(repoUrl, tempDir!);
            const uri = vscode.Uri.file(tempDir!);

            // Open the cloned repository in a new VS Code window
            console.log(`Opening cloned repository in new VS Code window: ${tempDir}`);
            await vscode.commands.executeCommand('vscode.openFolder', uri, true);
            // Clear tempDir so this window's deactivate() doesn't delete it —
            // the new window's extension instance will handle cleanup instead.
            tempDir = undefined;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to clone repository: ${error.message}`);
            console.error(`Failed to clone repository: ${error.message}`);
            if (tempDir) {
                console.log(`Error cloning repository, deleting temporary directory: ${tempDir}`);
                fs.rmdirSync(tempDir, { recursive: true });
            }
        }
    });
}

function getRepoNameFromUrl(repoUrl: string): string | null {
    const match = repoUrl.match(/\/([^\/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
}

async function cloneRepo(repoUrl: string, targetPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        exec(`git clone ${repoUrl} ${targetPath}`, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr));
            } else {
                resolve();
            }
        });
    });
}

export function deactivate() {
    if (tempDir) {
        console.log(`Extension deactivated, deleting temporary directory: ${tempDir}`);
        fs.rmdirSync(tempDir, { recursive: true });
    }
}