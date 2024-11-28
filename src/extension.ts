import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

let tempDir: string | undefined;

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.cloneTempRepo', async () => {
        const repoUrl = await vscode.window.showInputBox({ prompt: 'Enter the Git repository URL' });
        if (!repoUrl) {
            vscode.window.showErrorMessage('Repository URL is required');
            return;
        }

        const repoName = getRepoNameFromUrl(repoUrl);
        if (!repoName) {
            vscode.window.showErrorMessage('Invalid repository URL');
            return;
        }

        tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), `${repoName}-vscode-clone-`));
        console.log(`Temporary directory created: ${tempDir}`);

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Cloning Repository",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
            try {
                await cloneRepo(repoUrl, tempDir!);
                const uri = vscode.Uri.file(tempDir!);

                // Open the cloned repository in a new VS Code window
                await vscode.commands.executeCommand('vscode.openFolder', uri, true);

                // Listen for visible text editor changes
                const editorDispose = vscode.window.onDidChangeVisibleTextEditors((editors) => {
                    const editor = editors.find(e => e.document.uri.fsPath === tempDir);
                    if (!editor) {
                        // If the editor for the cloned repo is no longer visible, clean up
                        console.log(`Editor for the cloned repo is no longer visible, deleting temporary directory: ${tempDir}`);
                        if (tempDir) {
                            fs.rmdirSync(tempDir, { recursive: true });
                        }
                        tempDir = undefined;
                    }
                });

                context.subscriptions.push(editorDispose);

            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to clone repository: ${error.message}`);
                if (tempDir) {
                    console.log(`Error cloning repository, deleting temporary directory: ${tempDir}`);
                    fs.rmdirSync(tempDir, { recursive: true });
                }
            }
        });
    });

    // Ensure cleanup if extension is deactivated and temp folder still exists
    context.subscriptions.push({
        dispose: () => {
            if (tempDir) {
                console.log(`Extension deactivated, deleting temporary directory: ${tempDir}`);
                fs.rmdirSync(tempDir, { recursive: true });
            }
        }
    });

    context.subscriptions.push(disposable);
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

function getRepoNameFromUrl(repoUrl: string): string | null {
    const match = repoUrl.match(/\/([^\/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
}

export function deactivate() {
    // Clean up the temp directory if the extension is deactivated
    if (tempDir) {
        console.log(`Extension deactivated, deleting temporary directory: ${tempDir}`);
        fs.rmdirSync(tempDir, { recursive: true });
    }
}