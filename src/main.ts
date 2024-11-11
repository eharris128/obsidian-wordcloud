import { App, Editor, Notice, Plugin, PluginSettingTab, Setting, Platform } from 'obsidian';
import { createBlueskyPost } from '@/bluesky';
import { BlueskyTab } from '@/views/BlueskyTab';
import { BLUESKY_TITLE, VIEW_TYPE_TAB } from '@/consts';
import { setIcon } from "obsidian";

interface FileSystemOperations {
    isWritable: () => Promise<boolean>;
    writeFile: (path: string, data: string) => Promise<void>;
    readFile: (path: string) => Promise<string>;
}

class DesktopFileSystem implements FileSystemOperations {
    private fs: typeof import('fs');

    constructor() {
        this.fs = require('fs');
    }

    async isWritable(): Promise<boolean> {
        try {
            await this.fs.promises.access('.', this.fs.constants.W_OK);
            return true;
        } catch {
            return false;
        }
    }

    async writeFile(path: string, data: string): Promise<void> {
        await this.fs.promises.writeFile(path, data, 'utf8');
    }

    async readFile(path: string): Promise<string> {
        return await this.fs.promises.readFile(path, 'utf8');
    }
}

class MobileFileSystem implements FileSystemOperations {
    async isWritable(): Promise<boolean> {
        return false;
    }

    async writeFile(path: string, data: string): Promise<void> {
        throw new Error('Direct filesystem access not available on mobile');
    }

    async readFile(path: string): Promise<string> {
        throw new Error('Direct filesystem access not available on mobile');
    }
}

interface BlueskyPluginSettings {
    blueskyIdentifier: string;
    blueskyAppPassword: string;
}

const INITIAL_BLUESKY_SETTINGS: BlueskyPluginSettings = {
    blueskyIdentifier: '',
    blueskyAppPassword: ''
}

export default class BlueskyPlugin extends Plugin {
    settings: BlueskyPluginSettings;
    private fileSystem: FileSystemOperations;

    constructor(app: App, manifest: any) {
        super(app, manifest);
        this.fileSystem = Platform.isDesktop 
            ? new DesktopFileSystem()
            : new MobileFileSystem();
    }

    async activateBlueskyTab() {
        const { workspace } = this.app;
        
        // Check filesystem access
        try {
            const isWritable = await this.fileSystem.isWritable();
            console.log('File system is writable:', isWritable);
        } catch (err) {
            console.error('File system check failed:', err);
        }
        
        const leaf = workspace.getLeaf(true);
        
        await leaf.setViewState({
            type: VIEW_TYPE_TAB,
            active: true,
        });
    }

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'post-to-wordcloud',
            name: 'Post highlighted text',
            editorCallback: async (editor: Editor) => {
                const selectedText = editor.getSelection();
                if (!selectedText) {
                    new Notice('Please select some text to post');
                    return;
                }

                try {
                    await createBlueskyPost(this, selectedText);
                    new Notice('Successfully posted to Bluesky!');
                } catch (error) {
                    new Notice(`Failed to post: ${error.message}`);
                }
            }
        });
        
        this.registerView(
            VIEW_TYPE_TAB,
            (leaf) => new BlueskyTab(leaf, this)
        );

        this.addCommand({
            id: 'open-wordcloud-tab',
            name: 'Open tab',
            callback: () => this.openTab()
        });

        this.addRibbonIcon("megaphone", BLUESKY_TITLE, () => {
            this.activateBlueskyTab();
        });

        this.addSettingTab(new BlueskySettingTab(this.app, this));
    }

    // Helper method to handle filesystem operations safely
    async withFileSystem<T>(
        operation: (fs: FileSystemOperations) => Promise<T>,
        fallback: T
    ): Promise<T> {
        try {
            return await operation(this.fileSystem);
        } catch (error) {
            console.error('Filesystem operation failed:', error);
            return fallback;
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, INITIAL_BLUESKY_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async openTab() {
        const { workspace } = this.app;
        
        await workspace.getLeaf(true).setViewState({
            type: VIEW_TYPE_TAB,
            active: true
        });
    }

    addIcon(element: HTMLElement, iconId: string) {
        setIcon(element, iconId);
    }
}

class BlueskySettingTab extends PluginSettingTab {
    plugin: BlueskyPlugin;

    constructor(app: App, plugin: BlueskyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('p', {
            text: 'To get your app password:',
        });
        const steps = containerEl.createEl('ol');
        const li = steps.createEl('li');
        li.setText('Go to Bluesky App Passwords ');
        li.createEl('a', {
            text: 'page',
            href: 'https://bsky.app/settings/app-passwords'
        });
        steps.createEl('li', { text: 'Click "Add App Password"' });
        steps.createEl('li', { text: 'Give it a name (e.g. "Obsidian")' });
        steps.createEl('li', { text: 'Click "Create App Password"' });
        steps.createEl('li', { text: 'Copy the generated password' });

        new Setting(containerEl)
            .setName('Bluesky identifier')
            .setDesc('Your Bluesky handle or email (required)')
            .addText(text => text
                .setPlaceholder('handle.bsky.social')
                .setValue(this.plugin.settings.blueskyIdentifier)
                .onChange(async (value) => {
                    this.plugin.settings.blueskyIdentifier = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Bluesky app password')
            .setDesc('Your Bluesky app password (required)')
            .addText(text => text
                .setPlaceholder('Enter app password')
                .then(text => text.inputEl.type = 'password')
                .setValue(this.plugin.settings.blueskyAppPassword)
                .onChange(async (value) => {
                    this.plugin.settings.blueskyAppPassword = value;
                    await this.plugin.saveSettings();
                }));
    }
}
