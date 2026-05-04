import { createHash } from 'crypto'
import { readJsonSync } from 'fs-extra'
import _ from 'lodash'
import fetch from 'node-fetch'
import { resolve } from 'path'
import Handler, { HandlerDetail } from './handler'

export class KCRDB implements Handler {
  private readonly BASE_URL = 'https://kcrdb.hitomaru.dev'
  // private readonly BASE_URL = 'http://localhost:8880'

  private readonly QUEST_HASH_FIELDS = [
    'api_no',
    'api_category',
    'api_type',
    'api_label_type',
    'api_title',
    'api_detail',
    'api_voice_id',
    'api_lost_badges',
    'api_get_material',
    'api_select_rewards',
    'api_bonus_flag',
    'api_state',
  ]

  private readonly REMODEL_SKIP_API_ID = [101, 201, 301, 306]

  private readonly appVersion: string
  private readonly pluginName: string
  private readonly pluginVersion: string

  private readonly questHashes = new Set()

  private remodelRequestMs?: number
  private remodelEquip?: any

  constructor() {
    const pkg = readJsonSync(resolve(__dirname, '../package.json'))
    this.appVersion = _.get(window, 'POI_VERSION', 'unknown')
    this.pluginName = pkg.name
    this.pluginVersion = pkg.version
  }

  //#region global

  public static getJSTDay(ms?: number): number {
    const date = ms ? new Date(ms) : new Date()
    date.setUTCHours(date.getUTCHours() + 9)
    return date.getUTCDay()
  }

  public static hash(s: string, algorithm = 'sha256'): string {
    const res = createHash(algorithm).update(s).digest('hex')
    return res
  }

  /**
   * poi#getStore
   */
  public static getStore(): Record<string, any> {
    return (globalThis as any).getStore() || {}
  }

  /**
   * poi#getStore#info
   */
  public static getInfo(): Record<string, any> {
    return KCRDB.getStore().info
  }

  //#endregion

  public handle(path: string, body: any, reqBody: any, detail: HandlerDetail): void {
    const dict: Record<string, any[]> = {
      'api_get_member/questlist': [this.processQuestList],
      'api_req_quest/clearitemget': [this.processClearItemGet],

      'api_req_kousyou/remodel_slotlist': [this.processRemodelSlotList],
      'api_req_kousyou/remodel_slotlist_detail': [this.processRemodelSlotListDetail],
      'api_req_kousyou/remodel_slot': [this.processRemodelSlot],
      'api_req_kousyou/remodel_slot_recover': [this.processRemodelSlotRecover],
    }

    const handlers = dict[path] || []
    handlers.forEach(handler => handler.call(this, body, reqBody, detail))
  }

  public handleRequest(path: string, body: any, detail: HandlerDetail): void {
    const dict: Record<string, any[]> = {
      'api_req_kousyou/remodel_slotlist': [this.processRemodelRequest],
      'api_req_kousyou/remodel_slotlist_detail': [this.processRemodelRequest],
      'api_req_kousyou/remodel_slot': [this.processRemodelRequest],
      'api_req_kousyou/remodel_slot_recover': [this.processRemodelRequest],
    }

    const handlers = dict[path] || []
    handlers.forEach(handler => handler.call(this, body, detail))
  }

  //#region common

  public async send(path: string, data: any) {
    const url = new URL(path, this.BASE_URL)
    try {
      await fetch(url.href, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': `${this.pluginName}/${this.pluginVersion} poi/${this.appVersion}`,
          origin: 'poi',
          'x-origin': this.pluginName,
          'x-version': this.pluginVersion,
        },
        body: JSON.stringify(data),
      })
      console.debug(`[KCRDB] send: OK`, { path, data })
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[KCRDB] send: ${error.message}`, { path, data, error })
      }
    }
  }

  //#endregion

  //#region quest

  private async processQuestList(body: any) {
    const tmpList = body.api_list
    if (!tmpList || !Array.isArray(tmpList)) {
      return
    }

    const tmpItems = tmpList.map(data => {
      const hashObj = this.QUEST_HASH_FIELDS.reduce((obj, key) => {
        if (key in data) {
          Object.assign(obj, { [key]: data[key] })
        }
        return obj
      }, {})
      const hash = KCRDB.hash(JSON.stringify(hashObj))
      return { hash, data }
    })

    const newItems = tmpItems.filter(v => !this.questHashes.has(v.hash))
    if (!newItems.length) {
      return
    }

    const payload = { list: newItems.map(v => v.data) }
    await this.send('quests', payload)

    newItems.forEach(item => {
      this.questHashes.add(item.hash)
    })
  }

  private async processClearItemGet(body: any, reqBody: any) {
    const payload: Record<string, any> = {
      api_quest_id: Number(reqBody.api_quest_id),
      data: body,
    }

    const apiSelectNoKey = 'api_select_no'
    const apiSelectNoParams = Object.keys(reqBody).filter(key => key.startsWith(apiSelectNoKey))
    if (apiSelectNoParams.length > 0) {
      const pos = apiSelectNoKey.length
      apiSelectNoParams.sort((a, b) => Number(a.substring(pos)) - Number(b.substring(pos)))
      payload.api_select_no = apiSelectNoParams.map(k => Number(reqBody[k]))
    }

    await this.send('quest-items', payload)
  }

  //#endregion

  //#region remodel/akashi

  private processRemodelRequest(body: any, detail: HandlerDetail) {
    if (body?.api_slot_id) {
      const info = KCRDB.getInfo()
      const equip = info.equips[body.api_slot_id]
      this.remodelEquip = equip
    }

    this.remodelRequestMs = detail.time
  }

  private clearRemodelEquip() {
    this.remodelEquip = null
  }

  private createRemodelPayload() {
    const info = KCRDB.getInfo()
    const mstShips: Record<string | number, any> = info?.ships || {}
    const curShips: any[] = info?.fleets?.[0]?.api_ship || []
    const obj: Record<string, any> = {
      flag_ship_id: mstShips[curShips[0]]?.api_ship_id || 0,
      helper_ship_id: mstShips[curShips[1]]?.api_ship_id || 0,
      day: KCRDB.getJSTDay(this.remodelRequestMs),
    }
    return obj
  }

  /**
   * On akashi improvement items listed
   */
  private async processRemodelSlotList(body: any) {
    const payload = this.createRemodelPayload()
    payload.data = body

    const canSend = payload.flag_ship_id && payload.helper_ship_id && payload.data
    if (!canSend) {
      return
    }

    await this.send('remodel_slotlist', payload)
  }

  /**
   * On akashi improvement an item selected
   */
  private async processRemodelSlotListDetail(body: any, reqBody: any) {
    const info = KCRDB.getInfo()
    const payload = this.createRemodelPayload()
    payload.data = body
    payload.api_id = Number(reqBody.api_id)
    const equip = this.remodelEquip || info.equips[reqBody.api_slot_id]
    payload.api_slot_id = equip.api_slotitem_id
    payload.api_slot_level = equip.api_level || 0

    const canSend = payload.flag_ship_id && payload.helper_ship_id && payload.data && !this.REMODEL_SKIP_API_ID.includes(payload.api_id)
    if (!canSend) {
      return
    }

    try {
      await this.send('remodel_slotlist_detail', payload)
    } finally {
      this.clearRemodelEquip()
    }
  }

  /**
   * On akashi improvement previously selected procceeded
   */
  private async processRemodelSlot(body: any, reqBody: any) {
    const info = KCRDB.getInfo()
    const payload = this.createRemodelPayload()
    payload.data = body
    payload.api_id = Number(reqBody.api_id)
    const equip = this.remodelEquip || info.equips[reqBody.api_slot_id]
    payload.api_slot_id = equip.api_slotitem_id
    payload.api_slot_level = equip.api_level || 0
    payload.api_certain_flag = Number(reqBody.api_certain_flag)

    const isSuccess = !!body.api_remodel_flag
    if (!isSuccess) {
      return
    }

    const [idBefore, idAfter] = body.api_remodel_id
    // Fix item id and stars pre-improvement, since submission run after KC3GearManager's update
    payload.api_slot_id = idBefore
    payload.api_slot_level = idBefore !== idAfter ? 10 : body.api_after_slot.api_level - 1

    const canSend = payload.flag_ship_id && payload.helper_ship_id && payload.data && !this.REMODEL_SKIP_API_ID.includes(payload.api_id)
    if (!canSend) {
      return
    }

    try {
      await this.send('remodel_slot', payload)
    } finally {
      this.clearRemodelEquip()
    }
  }

  /**
   * On akashi improvement stars removal procceeded
   */
  private async processRemodelSlotRecover(body: any, reqBody: any) {
    const info = KCRDB.getInfo()
    const payload = this.createRemodelPayload()
    payload.api_id = Number(reqBody.api_menu_id)
    const equip = this.remodelEquip || info.equips[reqBody.api_slot_id]
    payload.api_slot_id = equip?.api_slotitem_id
    payload.api_slot_level = equip?.api_level || 0
    payload.api_dev_num = Number(reqBody.api_dev_num)
    payload.api_recover_flag = (body.api_data || {}).api_recover_flag || 0

    const canSend = payload.flag_ship_id && payload.api_slot_level && body.api_data && equip
    if (!canSend) {
      return
    }

    try {
      await this.send('remodel_slot_recover', payload)
    } finally {
      this.clearRemodelEquip()
    }
  }

  //#endregion
}
