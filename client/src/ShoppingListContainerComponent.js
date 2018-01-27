// @flow
import _ from 'lodash'
import low from 'lowdb'
import LocalStorage from 'lowdb/adapters/LocalStorage'
import lodashId from 'lodash-id'
import deepFreeze from 'deep-freeze'
import React, { Component } from 'react'
import {
  type SyncedShoppingList, type ShoppingList, type CompletionItem, type LocalItem, type Item, type UUID,
  createShoppingList, createSyncedShoppingList, itemToString, createRandomUUID,
  mergeShoppingLists
} from 'shoppinglist-shared'
import ShoppingListComponent from './ShoppingListComponent'

export type ConnectionState = "disconnected" | "polling" | "socket"

export type CreateItem = (item: LocalItem) => void
export type DeleteItem = (id: UUID) => void
export type UpdateItem = (id: UUID, localItem: LocalItem) => void
export type ManualSync = () => void


type Props = {
  listid: string,
}


type ClientShoppingList = {
  previousSync: ?SyncedShoppingList,
  recentlyDeleted: $ReadOnlyArray<string>,
  completions: $ReadOnlyArray<CompletionItem>,
  loaded: boolean,
  dirty: boolean,
  syncing: boolean,
  lastSyncFailed: boolean,
  connectionState: ConnectionState,
  // ShoppingList
  id: string,
  title: string,
  items: $ReadOnlyArray<Item>,
}

type State = ClientShoppingList

const initialState: ClientShoppingList = deepFreeze({
  id: "",
  title: "",
  items: [],
  previousSync: null,
  recentlyDeleted: [],
  completions: [],
  loaded: false,
  dirty: false,
  syncing: false,
  lastSyncFailed: false,
  connectionState: "disconnected",
})

function getShoppingList(clientShoppingList: ClientShoppingList): ShoppingList {
  return createShoppingList(_.pick(clientShoppingList, ['id', 'title', 'items']))
}

class HTTPErrorStatusError extends Error {
  code: number

  constructor(msg: String, code: number) {
    super(msg)
    this.code = code
    Error.captureStackTrace(this, HTTPErrorStatusError)
  }
}

function responseToJSON(res: Response) {
  if (!res.ok) {
    return res.json()
      .then(json => {
        const errorMessage = json && json.error
        throw new HTTPErrorStatusError(errorMessage, res.status)
      })
  }
  return res.json()
}

export default class ShoppingListContainerComponent extends Component<Props, State> {
  requestSync: () => Promise<void>
  db: Object
  socket: ?WebSocket
  supressSave: boolean
  isInSyncMethod: boolean
  waitForOnlineTimeoutId: number
  changePushSyncTimeoutId: number

  constructor(props: Props) {
    super(props)

    // $FlowFixMe
    this.requestSync = _.debounce(this.sync.bind(this), 500)

    const adapter = new LocalStorage('db')
    this.db = low(adapter)
    this.db._.mixin(lodashId)
    this.db.defaults({lists: []}).write()

    this.state = this.db.get('lists').getById(this.props.listid).value() || initialState
    this.supressSave = false

    setInterval(() => {
      //console.log(`Socket state: ${this.socket && this.socket.readyState}`)
    }, 1000)
  }

  componentDidMount() {
    window.addEventListener('storage', this.handleStorage)
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)

    this.initiateSyncConnection()
  }

  componentWillUnmount() {
    window.removeEventListener('storage', this.handleStorage)
    window.removeEventListener('online', this.handleOnline)
    window.removeEventListener('offline', this.handleOffline)

    if (this.socket != null) {
      this.socket.onclose = () => {}
      this.socket.close()
    }
  }

  componentDidUpdate() {
    if (!this.supressSave && this.state.loaded) {
      console.info('Save')
      this.db.get('lists').upsert(this.state).write()
    }
    this.supressSave = false
  }

  load(callback? : () => void) {
    console.info('load')
    this.supressSave = true
    this.setState(this.db.read().get('lists').getById(this.props.listid).value() || initialState, callback)
  }

  clearLocalStorage() {
    if (this.socket != null) {
      this.socket.onclose = () => {}
      this.socket.close()
    }
    this.db.get('lists').removeById(this.props.listid).write()
    this.load(() => {
      this.initiateSyncConnection()
    })
  }

  initiateSyncConnection() {
    this.sync()

    if (this.socket != null && this.socket.readyState === WebSocket.OPEN) {
      this.setState({ connectionState: "socket" })
      return
    }

    const protocol = (window.location.protocol === "https:") ? "wss://" : "ws://"
    const base = protocol + window.location.host
    let onopenTimoutId: number
    this.socket = new WebSocket(base + `/api/${this.props.listid}/socket`);
    this.socket.onopen = () => {
      onopenTimoutId = setTimeout(() => {
        console.log('socket open')
        this.setState({ connectionState: "socket" })
      }, 100)
    }
    this.socket.onmessage = evt => {
      console.log('Receiced change push!')
      clearTimeout(this.changePushSyncTimeoutId)
      this.changePushSyncTimeoutId = setTimeout(() => {
        if (this.state.previousSync != null && evt.data !== this.state.previousSync.token) {
          console.log('Tokens dont match, syncing!')
          this.sync()
        } else {
          console.log('Token already up to date')
        }
      }, 300)
    }
    this.socket.onerror = () => {
      console.log('error')
      clearTimeout(onopenTimoutId)
    }
    this.socket.onclose = () => {
      clearTimeout(onopenTimoutId)
      console.log('socket closed')
      if (window.navigator.onLine) {
        console.log('socket closed, polling')
        this.setState({ connectionState: "polling" })
        setTimeout(() => this.initiateSyncConnection(), 2000)
      } else {
        console.log('socket closed, offline')
        this.setState({ connectionState: "disconnected" })
        this.waitForOnline()
      }
    }
  }

  waitForOnline() {
    console.log('checking online')
    if (window.navigator.onLine) {
      this.initiateSyncConnection()
    } else {
      window.clearTimeout(this.waitForOnlineTimeoutId)
      this.waitForOnlineTimeoutId = window.setTimeout(() => this.waitForOnline(), 10000)
    }
  }

  sync(manuallyTriggered: boolean = false) {
    this.requestSync.cancel()

    if (this.isInSyncMethod) {
      console.log('Sync concurrent entry')
      return
    }
    this.isInSyncMethod = true
    console.log('Syncing')
    this.setState({
      syncing: true
    })

    let syncPromise
    if (!this.state.loaded) {
      console.log('initial sync!')
      syncPromise = fetch(`/api/${this.props.listid}/sync`)
        .then(responseToJSON)
        .then(json => {
          const serverSyncedShoppingList = createSyncedShoppingList(json)
          const serverShoppingList = _.omit(serverSyncedShoppingList, 'token')

          return {
            ...serverShoppingList,
            previousSync: serverSyncedShoppingList,
            dirty: false
          }
        })
    } else {
      const preSyncShoppingList = getShoppingList(this.state)

      syncPromise = fetch(`/api/${this.props.listid}/sync`, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          method: "POST",
          body: JSON.stringify({
            previousSync: this.state.previousSync,
            currentState: preSyncShoppingList
          })
        })
        .then(responseToJSON)
        .then(json => {
          const serverSyncedShoppingList = createSyncedShoppingList(json)

          const serverShoppingList = _.omit(serverSyncedShoppingList, 'token')
          const clientShoppingList = getShoppingList(this.state)
          const dirty = !_.isEqual(preSyncShoppingList, clientShoppingList)
          const newShoppingList = mergeShoppingLists(preSyncShoppingList, clientShoppingList, serverShoppingList)

          const revSL = {...newShoppingList, items: [...newShoppingList.items].reverse()}

          return {
            ...revSL,
            previousSync: serverSyncedShoppingList,
            dirty: dirty
          }
        })
    }

    const completionsPromise = fetch(`/api/${this.props.listid}/completions`).then(responseToJSON)

    Promise.all([syncPromise, completionsPromise])
      .then(([syncState, completions]) => {
        const newState = {
          completions: completions,
          syncing: false,
          loaded: true,
          lastSyncFailed: false,
          ...syncState,
        }

        this.setState(newState)
        this.isInSyncMethod = false
        console.log('done syncing')

        if (syncState.dirty) {
          console.warn('dirty after sync, resyncing')
          this.sync();
        }
      })
      .catch(e => {
        let failedState = {
          lastSyncFailed: true,
          syncing: false,
        }
        this.setState(failedState)
        this.isInSyncMethod = false
        console.log('done syncing, failed', e)
      })
  }


  handleStorage = (e: StorageEvent) => {
    // TODO filter for list
    this.load()
  }

  handleOnline = () => {
    this.initiateSyncConnection()
  }

  handleOffline = () => {
    console.log("offline")
    this.setState({ connectionState: "disconnected" })
    this.waitForOnline()
  }

  createItem = (localItem: LocalItem) => {
    const item = {...localItem, id: createRandomUUID()}
    this.setState((prevState) => {
      const str = itemToString(item)
      const recentlyDeleted = prevState.recentlyDeleted.filter((strRepr) => strRepr !== str)
      return {
        items: [...prevState.items, item],
        recentlyDeleted: recentlyDeleted,
        dirty: true,
      }
    }, this.requestSync)
  }

  deleteItem = (id: UUID) => {
    this.setState((prevState) => {
      const toDelete = prevState.items.find((item) => item.id === id)
      if (toDelete == null) {
        return {}
      }
      const str = itemToString(toDelete)
      const listItems = [...prevState.items].filter((item) => item.id !== id)
      let recentlyDeleted = [...prevState.recentlyDeleted.filter((strRepr) => strRepr !== str), str]
      recentlyDeleted = recentlyDeleted.slice(Math.max(0, recentlyDeleted.length - 10), recentlyDeleted.length)
      return {
        items: listItems,
        recentlyDeleted: recentlyDeleted,
        dirty: true,
      }
    }, this.requestSync)
  }

  updateItem = (id: UUID, localItem: LocalItem) => {
    const item = {...localItem, id: id}

    this.setState((prevState) => {
      const listItems = [...prevState.items]
      const index = _.findIndex(listItems, (item) => item.id === id)
      listItems[index] = item

      return {
        items: listItems,
        dirty: true
      }
    }, this.requestSync)
  }

  render() {
    return (
      <div>
        {this.state.loaded &&
          <ShoppingListComponent
            shoppingList={getShoppingList(this.state)}
            recentlyDeleted={this.state.recentlyDeleted}
            completions={this.state.completions}
            connectionState={this.state.connectionState}
            syncing={this.state.syncing}
            lastSyncFailed={this.state.lastSyncFailed}
            dirty={this.state.dirty}
            createItem={this.createItem} deleteItem={this.deleteItem}
            updateItem={this.updateItem} manualSync={this.initiateSyncConnection.bind(this)}
          />
        }
        <div>{this.state.loaded ? 'loaded' : 'not loaded'}</div>
        <div>{this.state.syncing ? 'syncing' : 'not syncing'}</div>
        <div>{this.state.dirty ? 'dirty' : 'unchanged'}</div>
        <div>{this.state.lastSyncFailed ? 'Last sync failed' : 'last sync successful'}</div>
        <div>Connection state: {this.state.connectionState}</div>
        <button onClick={this.clearLocalStorage.bind(this)}>Clear local storage</button>
      </div>
    )
  }
}
