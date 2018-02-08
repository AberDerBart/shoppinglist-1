// @flow
import React, { Component } from 'react'
import { type ShoppingList, type CompletionItem, type LocalItem, type CategoryDefinition } from 'shoppinglist-shared'
import type { ConnectionState, UpdateListTitle, CreateItem, DeleteItem, UpdateItem } from './ShoppingListContainerComponent'
import TopBarComponent from './TopBarComponent'
import EditItemComponent from './EditItemComponent'
import CreateItemComponent from './CreateItemComponent'
import KeyFocusComponent from './KeyFocusComponent'
import './ShoppingListComponent.css'

type Props = {
  shoppingList: ShoppingList,
  recentlyDeleted: $ReadOnlyArray<LocalItem>,
  completions: $ReadOnlyArray<CompletionItem>,
  categories: $ReadOnlyArray<CategoryDefinition>,
  connectionState: ConnectionState,
  syncing: boolean,
  lastSyncFailed: boolean,
  dirty: boolean,
  updateListTitle: UpdateListTitle,
  createItem: CreateItem,
  deleteItem: DeleteItem,
  updateItem: UpdateItem,
  manualSync: () => void,
  clearLocalStorage: () => void,
}

export default class ShoppingListComponent extends Component<Props> {
  clearLocalStorage = () => {
    const performClear = window.confirm('This will delete any unsynced data and your recently deleted items. Continue?')
    if (performClear) {
      this.props.clearLocalStorage()
    }
  }

  render() {
    return (
      <div className="ShoppingListComponent">
        <TopBarComponent
          title={this.props.shoppingList.title} connectionState={this.props.connectionState}
          syncing={this.props.syncing} lastSyncFailed={this.props.lastSyncFailed}
          manualSync={this.props.manualSync} updateListTitle={this.props.updateListTitle}
          dirty={this.props.dirty}
        />
        <div  className="ShoppingListComponent__body">
          <KeyFocusComponent direction="vertical" rootTagName="ul" className="ShoppingListComponent__section">
          {this.props.shoppingList.items.map((item) =>
              <EditItemComponent  key={item.id} item={item} categories={this.props.categories} deleteItem={this.props.deleteItem} updateItem={this.props.updateItem} />

          )}
          {!this.props.shoppingList.items.length &&
            <div className="ShoppingListComponent__emptyList">
              <p>Empty list, nothing needed 🎉</p>
              <p className="ShoppingListComponent__emptyList__addCallout--singleCol">⬇️ Add some new stuff below ⬇️</p>
              <p className="ShoppingListComponent__emptyList__addCallout--twoCol">➡️ Add some new stuff to the right ➡️</p>
            </div>
          }
          </KeyFocusComponent>
          <div className="ShoppingListComponent__section">
            <CreateItemComponent
              recentlyDeleted={this.props.recentlyDeleted}
              completions={this.props.completions}
              categories={this.props.categories}
              createItem={this.props.createItem} />
          </div>
        </div>
        <div className="ShoppingListComponent__footer">
          <h2>Debug</h2>
          <button type="button" onClick={this.props.manualSync}>Force Sync</button>
          <button type="button" onClick={this.clearLocalStorage}>Clear Local Storage</button>
        </div>
      </div>
    )
  }
}
