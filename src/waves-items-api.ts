import {
  IWavesItemsApi,
  IItemOrder,
  TItem,
  IParamMap,
  IItemMap,
  TIssue,
  TData,
  IUserInventory,
  IPreview,
  IEntries,
  IBroadcast,
} from './interface'
import { order, cancelOrder, IOrder, ICancelOrder } from '@waves/waves-transactions'
import { TChainId, ChaidId } from '@waves/waves-crypto'
import { wavesApi, config, axiosHttp } from '@waves/waves-rest'
import './extensions'
import axios from 'axios'
import memoizee from 'promise-memoize'
import { IItemV1 } from './v1'
import { parseItem } from './parse-item'
import { Versions } from './versions'
import { toInt } from './utils'
import { signWithKeeper } from 'keeper'
import { txsForItemCreate } from 'txs-for-item-create'

export const wavesItemsApi = (chainId: TChainId): IWavesItemsApi => {
  const cfg = ChaidId.isMainnet(chainId) ? config.mainnet : config.testnet

  const {
    broadcast,
    getIssueTxs,
    getKeyValuePairs,
    getAssetsBalance,
    getAssetInfo,
    getValueByKey,
    placeOrder,
    cancelOrder: cancelOrderApi,
  } = wavesApi(cfg, axiosHttp(axios))

  const createItem = <V extends Versions>(
    params: IParamMap[V],
  ): IPreview<IItemMap[V]> & IEntries<[TIssue, TData]> & IBroadcast<IItemMap[V]> => {
    const txs = memoizee(
      async (seed?: string): Promise<[TIssue, TData]> => {
        const txs = txsForItemCreate(params, chainId, seed)
        if (!seed) {
          return (await signWithKeeper(txs)) as [TIssue, TData]
        }
        return txs
      },
    )

    const preview = async (seed?: string): Promise<IItemMap[V]> => {
      const [issue, data] = await txs(seed)
      return parseItem(issue, data)
    }

    return {
      entries: txs,
      preview,
      broadcast: async (seed?: string): Promise<IItemV1> => {
        const [issue, data] = await txs(seed)
        await Promise.all([broadcast(issue), broadcast(data)])
        return preview(seed)
      },
    }
  }

  const getItemCatalog = async (gameId: string): Promise<TItem[]> => {
    const [issues, kvp] = await Promise.all([
      await getIssueTxs({ sender: gameId })
        .all()
        .then(i => i.toRecord(x => x.id)),
      await getKeyValuePairs(gameId),
    ])

    return kvp
      .filter(({ key }) => issues[key] != undefined)
      .map(kvp => {
        try {
          return parseItem(issues[kvp.key], kvp)
        } catch (error) {
          return undefined
        }
      })
      .filter(x => x != undefined)
  }

  const getUserInventory = async (gameId: string, address: string): Promise<IUserInventory> => {
    const { balances } = await getAssetsBalance(address)
    const i = (await getItemCatalog(gameId)).toRecord(x => x.id)
    const items = balances
      .filter(({ assetId }) => i[assetId])
      .map(({ balance, assetId }) => ({ balance: toInt(balance), item: i[assetId] }))
    return { items }
  }

  const getItem = async (itemId: string): Promise<TItem> => {
    const info = await getAssetInfo(itemId)
    const { value } = await getValueByKey(info.issuer, info.assetId)

    return parseItem(info, { key: info.assetId, value, type: 'string' })
  }

  const buyItem = (itemId: string, price: number): IEntries<IOrder> & IBroadcast<IItemOrder> => {
    const entries = async (seed: string) =>
      order(
        {
          amount: 1,
          price: price,
          matcherPublicKey: cfg.matcherPublicKey,
          orderType: 'buy',
          amountAsset: itemId,
          priceAsset: null,
        },
        seed,
      )

    return {
      entries,
      broadcast: async (seed: string): Promise<IItemOrder> => {
        const o = await entries(seed)
        const item = await getItem(itemId)
        const { id } = await placeOrder(o)
        return { id, price, item, type: 'buy' }
      },
    }
  }

  const sellItem = (itemId: string, price: number): IEntries<IOrder> & IBroadcast<IItemOrder> => {
    const entries = async (seed: string) =>
      order(
        {
          amount: 1,
          price: price,
          matcherPublicKey: cfg.matcherPublicKey,
          orderType: 'buy',
          amountAsset: itemId,
          priceAsset: null,
        },
        seed,
      )

    return {
      entries,
      broadcast: async (seed: string): Promise<IItemOrder> => {
        const o = await entries(seed)
        const item = await getItem(itemId)
        const { id } = await placeOrder(o)

        return { id, price, item, type: 'sell' }
      },
    }
  }

  const _cancelOrder = (order: IItemOrder): IEntries<ICancelOrder> & IBroadcast<void> => {
    const entries = async (seed: string) => cancelOrder({ orderId: order.id }, seed)

    return {
      entries,
      broadcast: async (seed: string) => {
        const o = await entries(seed)
        return await cancelOrderApi(order.item.id, 'WAVES', o)
      },
    }
  }

  return {
    createItem,
    getItem,
    getUserInventory,
    getItemCatalog,
    buyItem,
    sellItem,
    cancelOrder: _cancelOrder,
  }
}
