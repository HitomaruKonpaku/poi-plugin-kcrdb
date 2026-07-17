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

  private readonly QUEST_TITLE_TO_VERIFY: Record<string, string> = {
    '261': '海上輸送路の安全確保に努めよ！',
    '256': '「潜水艦隊」出撃せよ！',
    '888': '新編成「三川艦隊」、鉄底海峡に突入せよ！',
    '303': '「演習」で練度向上！',
    '402': '「遠征」を３回成功させよう！',
    '503': '艦隊大整備！',
    '605': '新装備「開発」指令',
    '637': '「熟練搭乗員」養成',
    '1123': '改良三座水上偵察機の増備',
  }

  private readonly QUEST_DETAIL_TO_VERIFY: Record<string, string> = {
    '261': '鎮守府正面の対潜哨戒を反復実施し、安全な海上輸送路を確保せよ！',
    '256': '潜水艦戦力を中核とした艦隊で中部海域哨戒線へ反復出撃、敵戦力を漸減せよ！',
    '888':
      '鉄底海峡戦果拡張：「鳥海」「青葉」「衣笠」「加古」「古鷹」「天龍」「夕張」の中から4隻を含む突入<br>艦隊を編成。南方海域前面及びサブ島沖海域、サーモン海域に突入、敵艦隊を撃滅せよ！',
    '637': '勲章x2消費：「鳳翔」秘書艦に練度max及び改修max「九六式艦戦」を搭載、熟練搭乗員を養成せよ！<br>(任務達成後、部隊は消滅します)',
    '1123':
      '旗艦「利根改二」または「由良改二」第一スロに最大改修「零式水上偵察機」。「九七式艦攻(九三一空)」<br>x2廃棄、ボーキ950、新型航空兵装資材x2、開発資材x35、熟練搭乗員x2を準備！',
  }

  private readonly REMODEL_SKIP_API_ID = [101, 201, 301, 306]

  private readonly appVersion: string
  private readonly pluginName: string
  private readonly pluginVersion: string

  private readonly questHashes = new Set()

  private alterQuestDetected: boolean = false
  private remodelRequestMs?: number
  private remodelEquip?: any

  //#region event-reward

  private currentMap: [number, number] = [0, 0]
  private mapInfo: any[] = []
  private sortieData: { map: string | null; difficulty: number | null } = {
    map: null,
    difficulty: null,
  }

  //#endregion

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

      //#region event-reward

      'api_get_member/mapinfo': [this.processMapInfo],
      'api_req_map/select_eventmap_rank': [this.processSelectEventMapRank],
      'api_req_map/start': [this.processStart],
      'api_req_map/next': [this.processNext],
      'api_req_sortie/battleresult': [this.processEventReward],
      'api_req_combined_battle/battleresult': [this.processEventReward],

      //#endregion
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

  private verifyIfQuestAltered(list: any[]): void {
    this.alterQuestDetected = !!(
      Array.isArray(list) &&
      list.find(quest => {
        if (quest === -1) {
          return false
        }
        const id: string = String((quest || {}).api_no)
        if (this.QUEST_TITLE_TO_VERIFY[id] && quest.api_title !== this.QUEST_TITLE_TO_VERIFY[id]) {
          return true
        }
        if (this.QUEST_DETAIL_TO_VERIFY[id] && quest.api_detail !== this.QUEST_DETAIL_TO_VERIFY[id]) {
          return true
        }
        return false
      })
    )
  }

  private async processQuestList(body: any, reqBody: any) {
    if (this.alterQuestDetected) {
      return
    }

    const tabId: number = parseInt(reqBody?.api_tab_id)
    const tmpList = body.api_list
    if (tabId === 0) {
      this.verifyIfQuestAltered(tmpList)
    }
    if (this.alterQuestDetected) {
      return
    }

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
    if (this.alterQuestDetected) {
      return
    }

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

  //#region event-reward

  private processMapInfo(body: any) {
    this.mapInfo = body.api_map_info
  }

  private processSelectEventMapRank(_body: any, reqBody: any) {
    const mapId = [reqBody.api_maparea_id, reqBody.api_map_no].join('')
    const mapData = this.mapInfo.find(i => i.api_id == mapId) || {}
    if (mapData.api_eventmap) {
      mapData.api_eventmap.api_selected_rank = Number(reqBody.api_rank)
    }
  }

  private processStart(body: any) {
    const world = Number(body.api_maparea_id)
    const map = Number(body.api_mapinfo_no)
    this.currentMap = [world, map]
    this.sortieData.map = this.currentMap.join('-')
    this.processNext(body)
  }

  private processNext(_body: any) {
    if (!this.currentMap || !this.currentMap[0] || !this.currentMap[1]) {
      return
    }

    const mapId = this.currentMap.join('')
    const mapData = this.mapInfo.find(i => i.api_id == mapId) || {}
    if (mapData.api_eventmap) {
      this.sortieData.difficulty = mapData.api_eventmap.api_selected_rank || 0
    }
  }

  private async processEventReward(body: any) {
    if (!body.api_get_eventitem) {
      return
    }

    if (!this.currentMap || !this.currentMap[0] || !this.currentMap[1]) {
      return
    }

    if (!this.sortieData?.difficulty) {
      return
    }

    const payload = {
      world: this.currentMap[0],
      map: this.currentMap[1],
      difficulty: this.sortieData.difficulty,
      api_get_eventitem: body.api_get_eventitem,
      api_select_reward_dict: body.api_select_reward_dict,
    }

    await this.send('event-rewards', payload)
  }

  //#endregion
}
