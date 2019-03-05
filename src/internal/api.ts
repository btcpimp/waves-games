import { Transport } from './transports/base'
import { AxiosTransport } from './transports/axios'
import { IOrder, WithId } from '@waves/waves-transactions'
import { IAssetInfo, IOrderData, ItemDetails, ItemParams } from './types'

export interface ApiOptions {
  nodeUri: string,
  matcherUri: string,
}

interface MatcherResponse {
  status: string,
  message?: object | string,
  orderId?: string,
}

export class Api {
  node: Transport
  matcher: Transport

  constructor(public options: ApiOptions) {
    this.node = new AxiosTransport({ url: options.nodeUri })
    this.matcher = new AxiosTransport({ url: options.matcherUri })
  }

  async getAssetInfo(assetId: string): Promise<IAssetInfo> {
    return await this.node.get<IAssetInfo>(`assets/details/${assetId}`)
  }

  async getItemParams(creatorAddress: string, itemId: string): Promise<ItemParams<any>> {
    return await this.node.get<ItemParams<any>>(`addresses/data/${creatorAddress}/${itemId}`)
  }

  async getItemDetailsList(creatorAddress: string): Promise<ItemDetails[]> {
    return await this.node.get<ItemDetails[]>(`addresses/data/${creatorAddress}`)
  }

  async placeOrder(order: IOrder): Promise<IOrder & WithId> {
    const res = await this.matcher.post<MatcherResponse>('orderbook', order)
    return res.message as IOrder & WithId
  }

  async cancelOrder(orderData: IOrderData): Promise<string> {
    const res = await this.matcher.post<MatcherResponse>('orderbook/cancel', orderData)
    return res.orderId
  }
}
