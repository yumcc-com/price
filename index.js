'use strict'

const COS = require('cos-nodejs-sdk-v5')
const rq = require('request-promise')
const nodemailer= require('nodemailer')
const fs = require('fs')

// 使用 cos 所需的鉴权/配置信息
const SECRET_ID = 'XXXXX' // 请替换为您的 SecretId
const SECRET_KEY = 'XXXXX' // 请替换为您的 SecretKey
const REGION = 'ap-guangzhou' // 请替换为您储存桶所在的地域，这里是广州
const BUCKET = 'price-123456789'  //创建的储存桶名称
const Threshold = 1000      //定义一个上下浮动的阈值
const Transaction = ['btc', 'qc']   //需要监测的交易对，qc是ZB平台的稳定币
const toUser = 'yumcc@qq.com'   // 收件人邮箱
const mailerData = {
    host: 'smtp.qq.com',
    secure: false,
    port: '这里填写smtp的端口',
    auth: {
        user: '这里填写发件人的邮箱账号',
        pass: '这里填写发件人申请的smtp密码'
    }
}   //  发件服务配置,这里用个人QQ邮箱的smtp服务

// cosSDK初始化
const cosInst = new COS({
    SecretId: SECRET_ID,
    SecretKey: SECRET_KEY
})

//  配置邮件信息
const transporter = nodemailer.createTransport(mailerData)

// 暂时解决cosSDK-getObject不支持promise的问题
cosInst.getObjectPromise = function (params) {
    return new Promise((resolve, reject) => {
        cosInst.getObject(params, function (err, data) {
            if (err) {
                reject(err)
            } else {
                resolve(data)
            }
        })
    })
}

// 暂时解决cosSDK-putObject不支持promise的问题
cosInst.putObjectPromise = function (params) {
    return new Promise((resolve, reject) => {
        cosInst.putObject(params, function (err, data) {
            if (err) {
                reject(err)
            } else {
                resolve(data)
            }
        })
    })
}

//  请求ZB平台数据的API接口
const GetData = async (type) => {
    return new Promise(async (resolve, reject) => {
        let options = {
            uri: `http://api.zb.plus/data/v1/ticker?market=${type}`,
            qs: {}
        }
        let res = await rq(options)
        resolve(res)
    })
}

const notice_fun = (params) => {
    return new Promise(async (resolve, reject) => {
        //  新建重写数据
        await cosInst.putObjectPromise({
            Bucket: BUCKET,
            Region: REGION,
            Key: 'data.json',
            Body: fs.createReadStream(`/tmp/data.json`)
        })
        //  发送邮件
        await transporter.sendMail(params)
    })
}

exports.main_handler = async (event, context, callback) => {
    //  交易对名称拼接，调用方法请求最新交易对数据
    let data = await GetData(Transaction.join('_'))
    // 往缓存写入最新的交易对数据
    await fs.writeFileSync(`/tmp/data.json`, data)
    // 获取储存在cos的旧交易对数据
    let file = await cosInst.getObjectPromise({
        Bucket: BUCKET,
        Region: REGION,
        Key: 'data.json'
    })
    //  解析新旧数据
    file = JSON.parse(file['Body'])
    data = JSON.parse(data)
    //  新旧数据的相差值
    let num = parseFloat(data.ticker.last) - parseFloat(file.ticker.last)
    //  当相差值大于等于或者小于等于设定的阈值时调用方法储存新数据并发送邮件通知用户
    if (num >= Threshold || num <= -Threshold) {
        let params = {
            from: `"SCF监测${Transaction[0]} 👻" <${mailerData.auth.user}>`,
            to: toUser,
            subject: `【${Transaction[0]}】${num >= Threshold ? '上涨' : '下跌'}了,最新价格${data.ticker.last}`,
            text: `最新价格${data.ticker.last},最高价${data.ticker.high},最低价${data.ticker.low},买一价${data.ticker.buy},卖一价${data.ticker.sell},成交量（最近的24小时）${data.ticker.vol}!!`
        }
        await notice_fun(params)
    }
    return {code: 1}
}