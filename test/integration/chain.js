/*
 * ISC License (ISC)
 * Copyright (c) 2018 aeternity developers
 *
 *  Permission to use, copy, modify, and/or distribute this software for any
 *  purpose with or without fee is hereby granted, provided that the above
 *  copyright notice and this permission notice appear in all copies.
 *
 *  THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 *  REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 *  AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 *  INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 *  LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 *  OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 *  PERFORMANCE OF THIS SOFTWARE.
 */
import { describe, it, before } from 'mocha'
import { getSdk } from './'
import { generateKeyPair } from '../../src/utils/crypto'

describe('Node Chain', function () {
  let walletClient, openClient
  const { publicKey } = generateKeyPair()

  before(async function () {
    walletClient = await getSdk()
    openClient = await getSdk({ withoutAccount: true })
  })

  it('determines the height', async () => {
    return openClient.height().should.eventually.be.a('number')
  })

  it('Compresses height queries', async () => {
    const origFun = openClient.api.getCurrentKeyBlockHeight
    try {
      var calls = 0
      openClient.api.getCurrentKeyBlockHeight = () => {
        calls += 1
        return origFun()
      }
      const H1P = openClient.height()
      const H2P = openClient.height()
      const H3P = openClient.height()
      const H1 = await H1P
      const H2 = await H2P
      const H3 = await H3P
      H1.should.be.equal(H2)
      H1.should.be.equal(H3)
      calls.should.be.equal(1)
    } finally {
      openClient.api.getCurrentKeyBlockHeight = origFun
    }
  })

  it('waits for specified heights', async () => {
    const target = await openClient.height() + 1
    await openClient.awaitHeight(target, { interval: 200, attempts: 100 }).should.eventually.be.at.least(target)
    return openClient.height().should.eventually.be.at.least(target)
  })
  it('Can verify transaction from broadcast error', async () => {
    try {
      await walletClient.spend(0, publicKey, { fee: 100, verify: false })
    } catch (e) {
      const validation = await e.verifyTx()
      validation.should.has.lengthOf(1)
    }
  })
  it('Get top block', async () => {
    const top = await openClient.topBlock()
    top.should.has.property('hash')
    top.should.has.property('height')
  })
  it('Get pending transaction', async () => {
    const mempool = await openClient.mempool()
    mempool.should.has.property('transactions')
  })
  it('Get current generation', async () => {
    const generation = await openClient.getCurrentGeneration()
    generation.should.has.property('keyBlock')
  })
  it('Get key block', async () => {
    const { keyBlock } = await openClient.getCurrentGeneration()
    const keyBlockByHash = await openClient.getKeyBlock(keyBlock.hash)
    const keyBlockByHeight = await openClient.getKeyBlock(keyBlock.height)
    const keyBlockError = await openClient.getKeyBlock(false).catch(e => true)
    keyBlockByHash.should.be.an('object')
    keyBlockByHeight.should.be.an('object')
    keyBlockError.should.be.equal(true)
  })
  it('Get generation', async () => {
    const { keyBlock } = await openClient.getCurrentGeneration()
    const genByHash = await openClient.getGeneration(keyBlock.hash)
    const genByHeight = await openClient.getGeneration(keyBlock.height)
    const genArgsError = await openClient.getGeneration(true).catch(e => true)
    genByHash.should.be.an('object')
    genByHeight.should.be.an('object')
    genArgsError.should.be.equal(true)
  })
  it('polls for transactions', async () => {
    const sender = await walletClient.address()
    const receiver = publicKey
    const tx = await walletClient.spendTx({
      amount: 1,
      senderId: sender,
      recipientId: receiver,
      payload: '',
      ttl: Number.MAX_SAFE_INTEGER
    })
    const signed = await walletClient.signTransaction(tx)
    const { txHash } = await walletClient.api.postTransaction({ tx: signed })

    await walletClient.poll(txHash, { interval: 50, attempts: 1200 }).should.eventually.be.fulfilled
    return walletClient.poll('th_xxx', { blocks: 1, interval: 50, attempts: 1200 }).should.eventually.be.rejected
  })

  it('Wait for transaction confirmation', async () => {
    const txData = await walletClient.spend(1000, await walletClient.address(), { confirm: true, interval: 400, attempts: 50 })
    const isConfirmed = (await walletClient.height()) >= txData.blockHeight + 3

    isConfirmed.should.be.equal(true)

    const txData2 = await walletClient.spend(1000, await walletClient.address(), { confirm: 4, interval: 400, attempts: 50 })
    const isConfirmed2 = (await walletClient.height()) >= txData2.blockHeight + 4
    isConfirmed2.should.be.equal(true)
  })
})
