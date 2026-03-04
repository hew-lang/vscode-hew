import * as vscode from 'vscode';

export class ActorTreeItem extends vscode.TreeItem {
    constructor(
        public readonly actorName: string,
        public readonly actorState: string,
    ) {
        super(actorName, vscode.TreeItemCollapsibleState.None);
        this.description = actorState;
        this.contextValue = 'hewActor';
    }
}

export class HewActorsProvider implements vscode.TreeDataProvider<ActorTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ActorTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private actors: ActorTreeItem[] = [];

    refresh(actors: ActorTreeItem[]): void {
        this.actors = actors;
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ActorTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): ActorTreeItem[] {
        return this.actors;
    }
}
