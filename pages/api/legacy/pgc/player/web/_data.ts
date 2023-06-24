import qs from "qs";
import * as env from "../../../../_config";
import * as blacklist from "../../../../utils/_blacklist";
import * as bili from "../../../../utils/_bili";
import * as playerUtil from "../../../../utils/_player";

const checkBlackList = async (uid: number): Promise<[boolean, number]> => {
  //黑白名单验证
  const blacklist_data = await blacklist.main(uid);
  if (blacklist_data.code != 0) return [false, 3];
  else {
    if (env.whitelist_enabled) {
      if (blacklist_data.data.is_whitelist) return [true, 0];
      else return [false, 5];
    }
    if (env.blacklist_enabled && blacklist_data.data.is_blacklist)
      return [false, 4];
    return [true, 0];
  }
};

/**
 * 数据处理中间件 \
 * 返回为 true - 继续执行 \
 * 返回为 false - 阻止进行 \
 * 返回为 true 时，0-标准执行 1-检查vip
 * 返回一个 [boolean,number] 参数0决定是否继续执行，参数1决定封锁信息
 * @param url_data 域名后的请求数据
 * @param cookies cookies
 * @return {boolean} boolean
 */
export const middleware = async (
  url_data: string,
  cookies: any, //FIXME 未添加完整类型
  PassWebOnCheck: 0 | 1
): Promise<[boolean, number]> => {
  env.log.obj("用户Cookies", cookies);
  //请求头验证
  if (!env.web_on && PassWebOnCheck === 0) return [false, 1];

  //信息获取
  const url = new URL(url_data, env.api.main.web.playurl);
  if (!url.search || !url.search) return [false, 7]; //缺少参数
  const data = qs.parse(url.search.slice(1));
  if (env.need_login && !data.access_key && !cookies.SESSDATA) {
    if (!env.need_login) return [true, 0]; //免登陆
    else return [false, 6]; //要求登录
  }

  //仅允许access_key或cookies鉴权
  let access_key: string;
  if (cookies.SESSDATA) {
    //拯救一下只传cookies的BBDown
    if (!cookies.DedeUserID) return [false, 6]; //FIXME DedeUserID处理问题
    access_key = await bili.cookies2access_key(cookies);
  }
  const info = await bili.access_key2info(
    (data.access_key as string) || access_key
  );
  if (!info) return [false, 6]; //查询信息失败
  env.log.obj("用户信息", {
    access_key: data.access_key as string,
    UID: info.uid,
    vip_type: info.vip_type,
    url: url_data,
  });
  await playerUtil.addNewLog_bitio({
    access_key: (data.access_key as string) || access_key,
    UID: info.uid,
    vip_type: info.vip_type,
    url: url_data,
  });
  await playerUtil.addNewLog_notion({
    access_key: (data.access_key as string) || access_key,
    UID: info.uid,
    vip_type: info.vip_type,
    url: url_data,
  });

  //黑白名单验证
  return checkBlackList(info.uid);
};

export const main = async (url_data: string, cookies) => {
  //信息获取
  const url = new URL(url_data, env.api.main.web.playurl);
  const data = qs.parse(url.search.slice(1));
  //有access_key优先，否则若有cookies用cookies
  if (data.access_key || cookies) {
    let info: { uid: number; vip_type: 0 | 1 | 2 }, access_key: string;
    if (cookies) access_key = await bili.cookies2access_key(cookies);
    info = await bili.access_key2info(
      (data.access_key as string) || access_key
    );
    const rCache = await playerUtil.readCache(
      Number(data.cid),
      Number(data.ep_id),
      info
    );
    if (rCache) return { code: 0, message: "success", result: rCache };
    else {
      const res = (await fetch(
        env.api.main.web.playurl +
          url_data +
          (access_key ? "&access_key=" + access_key : "")
      ).then((res) => res.json())) as { code: number; result: object };
      if (res.code === 0) await playerUtil.addNewCache(url_data, res?.result);
      return env.try_unblock_CDN_speed_enabled
        ? JSON.parse(JSON.stringify(res).replace(/bw=[^&]*/g, "bw=1280000"))
        : res; //尝试解除下载速度限制
    }
  } else {
    const res = (await fetch(env.api.main.web.playurl + url_data, {
      headers: { cookie: bili.cookies2usable(cookies) },
    }).then((res) => res.json())) as { code: number; result: object };
    if (res.code === 0) await playerUtil.addNewCache(url_data, res?.result);
    return env.try_unblock_CDN_speed_enabled
      ? JSON.parse(JSON.stringify(res).replace(/bw=[^&]*/g, "bw=1280000"))
      : res; //尝试解除下载速度限制
  }
};
