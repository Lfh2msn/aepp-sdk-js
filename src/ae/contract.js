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

/**
 * Contract module - routines to interact with the æternity contract
 *
 * High level documentation of the contracts are available at
 * https://github.com/aeternity/protocol/tree/master/contracts and
 *
 * @module @aeternity/aepp-sdk/es/ae/contract
 * @export Contract
 * @example import { Contract } from '@aeternity/aepp-sdk'
 */

import Ae from './'
import * as R from 'ramda'
import ContractCompilerAPI from '../contract/compiler'
import ContractBase from '../contract'
import getContractInstance from '../contract/aci'
import NodePool from '../node-pool'
import { AMOUNT, DEPOSIT, DRY_RUN_ACCOUNT, GAS, MIN_GAS_PRICE } from '../tx/builder/schema'
import { decode, produceNameId } from '../tx/builder/helpers'
import TxObject from '../tx/tx-object'

async function _sendAndProcess (tx, source, name, options) {
  const txData = await this.send(tx, options)
  const result = { hash: txData.hash, tx: TxObject({ tx: txData.rawTx }), txData, rawTx: txData.rawTx }
  if (options.waitMined === false) return result
  const txInfo = await this.getTxInfo(txData.hash)
  await this._handleCallError(source, name, txInfo)
  return { ...result, result: txInfo }
}

/**
 * Handle contract call error
 * @function
 * @private
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} source contract source code
 * @param {String} name name of called method
 * @param {Object} result call result object
 * @throws Error Decoded error
 * @return {Promise<void>}
 */
async function _handleCallError (source, name, result) {
  if (result.returnType === 'ok') return
  const error = await this.contractDecodeCallResultAPI(source, name, result.returnValue, result.returnType)
  const message = error[{ revert: 'abort' }[result.returnType] || result.returnType][0]
  throw new Error(`Invocation failed${message ? `: "${message}"` : ''}`)
}

/**
 * Encode call data for contract call
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} source Contract source code
 * @param {String} name Name of function to call
 * @param {Array} args Argument's for call
 * @param {Object} [options={}]  Options
 * @param {Object} [options.filesystem={}] Contract external namespaces map
  * @return {Promise<String>}
 */
async function contractEncodeCall (source, name, args, options) {
  return this.contractEncodeCallDataAPI(source, name, args, options)
}

/**
 * Decode contract call result data
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} source - source code
 * @param {String } fn - function name
 * @param {String} callValue - result call data
 * @param {String} callResult - result status
 * @param {Object} [options={}]  Options
 * @param {Object} [options.filesystem={}] Contract external namespaces map
 * @return {Promise<String>} Result object
 * @example
 * const decodedData = await client.contractDecodeData(SourceCode ,'functionName', 'cb_asdasdasd...', 'ok|revert')lt
 */
async function contractDecodeData (source, fn, callValue, callResult, options) {
  return this.contractDecodeCallResultAPI(source, fn, callValue, callResult, options)
}

/**
 * Static contract call(using dry-run)
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} source Contract source code
 * @param {String} address Contract address
 * @param {String} name Name of function to call
 * @param {Array|String} args Argument's or callData for call/deploy transaction
 * @param {Object} [options]
 * @param {Number|String} [options.top] Block height or hash on which you want to call contract
 * @param {String} [options.bytecode] Block hash on which you want to call contract
 * @param {Object} [options.filesystem] Contract external namespaces map
 * @return {Promise<Object>} Result object
 * @example
 * const callResult = await client.contractCallStatic(source, address, fnName, args)
 * {
 *   result: TX_DATA,
 *   decode: (type) => Decode call result
 * }
 */
async function contractCallStatic (source, address, name, args = [], options = {}) {
  const callerId = await this.address(options).catch(() => DRY_RUN_ACCOUNT.pub)
  if (typeof options.top === 'number') {
    options.top = (await this.getKeyBlock(options.top)).hash
  }
  const txOpt = {
    ...this.Ae.defaults,
    ...options,
    callData: Array.isArray(args) ? await this.contractEncodeCall(source, name, args, options) : args,
    nonce: options.top && (await this.getAccount(callerId, { hash: options.top })).nonce + 1
  }
  const tx = name === 'init'
    ? (await this.contractCreateTx({
      ...txOpt,
      code: options.bytecode,
      ownerId: callerId
    })).tx
    : await this.contractCallTx({
      ...txOpt,
      callerId,
      contractId: await this.resolveName(address, 'ct', { resolveByNode: true })
    })

  const { callObj, ...dryRunOther } = await this.txDryRun(tx, callerId, options)

  await this._handleCallError(source, name, callObj)
  const { returnType, returnValue } = callObj
  return {
    ...dryRunOther,
    tx: TxObject({ tx }),
    result: callObj,
    decode: () => this.contractDecodeData(source, name, returnValue, returnType, options)
  }
}

/**
 * Call contract function
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} source Contract source code
 * @param {String} address Contract address or AENS name
 * @param {String} name Name of function to call
 * @param {Array|String} argsOrCallData Argument's array or callData for call function
 * @param {Object} [options={}] Transaction options (fee, ttl, gas, amount, deposit)
 * @param {Object} [options.filesystem={}] Contract external namespaces map* @return {Promise<Object>} Result object
 * @example
 * const callResult = await client.contractCall(source, address, fnName, args = [], options)
 * {
 *   hash: TX_HASH,
 *   result: TX_DATA,
 *   decode: (type) => Decode call result
 * }
 */
async function contractCall (source, address, name, argsOrCallData = [], options = {}) {
  const opt = R.merge(this.Ae.defaults, options)

  const tx = await this.contractCallTx(R.merge(opt, {
    callerId: await this.address(opt),
    contractId: await this.resolveName(address, 'ct', { resolveByNode: true }),
    callData: Array.isArray(argsOrCallData) ? await this.contractEncodeCall(source, name, argsOrCallData, opt) : argsOrCallData
  }))

  const { hash, rawTx, result, txData } = await this._sendAndProcess(tx, source, name, opt)
  return {
    hash,
    rawTx,
    result,
    txData,
    decode: () => result ? this.contractDecodeData(source, name, result.returnValue, result.returnType, opt) : {}
  }
}

/**
 * Deploy contract to the node
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} code Compiled contract
 * @param {String} source Contract source code
 * @param {Array|String} initState Arguments of contract constructor(init) function. Can be array of arguments or callData string
 * @param {Object} [options={}] Transaction options (fee, ttl, gas, amount, deposit)
 * @param {Object} [options.filesystem={}] Contract external namespaces map* @return {Promise<Object>} Result object
 * @return {Promise<Object>} Result object
 * @example
 * const deployed = await client.contractDeploy(bytecode, source, init = [], options)
 * {
 *   owner: OWNER_PUB_KEY,
 *   transaction: TX_HASH,
 *   address: CONTRACT_ADDRESS,
 *   createdAt: Date,
 *   result: DEPLOY_TX_DATA,
 *   call: (fnName, args = [], options) => Call contract function,
 *   callStatic: (fnName, args = [], options) => Static all contract function
 * }
 */
async function contractDeploy (code, source, initState = [], options = {}) {
  const opt = { ...this.Ae.defaults, ...options, deposit: DEPOSIT }
  const callData = Array.isArray(initState) ? await this.contractEncodeCall(source, 'init', initState, opt) : initState
  const ownerId = await this.address(opt)

  const { tx, contractId } = await this.contractCreateTx(R.merge(opt, {
    callData,
    code,
    ownerId
  }))

  const { hash, rawTx, result, txData } = await this._sendAndProcess(tx, source, 'init', opt)
  return Object.freeze({
    result,
    owner: ownerId,
    transaction: hash,
    rawTx,
    txData,
    address: contractId,
    call: (name, args, options) =>
      this.contractCall(source, contractId, name, args, { ...opt, ...options }),
    callStatic: (name, args, options) =>
      this.contractCallStatic(source, contractId, name, args, { ...opt, ...options }),
    createdAt: new Date()
  })
}

/**
 * Compile contract source code
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} source Contract sourece code
 * @param {Object} [options={}] Transaction options (fee, ttl, gas, amount, deposit)
 * @param {Object} [options.filesystem={}] Contract external namespaces map* @return {Promise<Object>} Result object
 * @return {Promise<Object>} Result object
 * @example
 * const compiled = await client.contractCompile(SOURCE_CODE)
 * {
 *   bytecode: CONTRACT_BYTE_CODE,
 *   deploy: (init = [], options = {}) => Deploy Contract,
 *   encodeCall: (fnName, args = []) => Prepare callData
 * }
 */
async function contractCompile (source, options = {}) {
  const opt = { ...this.Ae.defaults, ...options }
  const bytecode = await this.compileContractAPI(source, options)
  return Object.freeze({
    encodeCall: (name, args) => this.contractEncodeCall(source, name, args, opt),
    deploy: (init, options) => this.contractDeploy(bytecode, source, init, { ...opt, ...options }),
    deployStatic: (init, options) => this.contractCallStatic(source, null, 'init', init, {
      ...opt,
      ...options,
      bytecode
    }),
    bytecode
  })
}

/**
 * Utility method to create a delegate signature for a contract
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String[]} ids The list of id's to prepend
 * @param {Object} [opt={}] options
 * @param {{ onAccount: String | Object }} [opt={}] opt Options
 * @return {Promise<String>} Signature in hex representation
 */
async function delegateSignatureCommon (ids = [], opt = {}) {
  return this.sign(
    Buffer.concat(
      [
        Buffer.from(this.getNetworkId(opt)),
        ...(Object.prototype.hasOwnProperty.call(opt, 'onAccount') ? [decode(await this.address(opt))] : []),
        ...ids.map(e => decode(e))
      ]
    ),
    opt
  ).then(s => Buffer.from(s).toString('hex'))
}

/**
 * Helper to generate a signature to delegate pre-claim/claim/transfer/revoke of a name to a contract.
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} contractId Contract Id
 * @param {String} [name] The name
 * @param {{ onAccount: String | Object }} [opt={}] opt Options
 * @return {Promise<String>} Signature for delegation
 * @example
 * const client = await Universal({ ... })
 * const contractId = 'ct_asd2ks...' // contract address
 * const name = 'example.chain' // AENS name
 * const onAccount = await client.address() Sign with a specific account
 * // Preclaim signature
 * const preclaimSig = await client.createAensDelegationSignature(contractId, { onAccount: current })
 * // Claim, transfer and revoke signature
 * const sig = await contract.createAensDelegationSignature(contractAddress, name, { onAccount: current })
 */
async function createAensDelegationSignature (contractId, name, opt = {}) {
  return (typeof name === 'string')
    ? this.delegateSignatureCommon([produceNameId(name), contractId], opt)
    : this.delegateSignatureCommon([contractId], opt)
}

/**
 * Helper to generate a signature to delegate a Oracle register to a contract.
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} contractId Contract Id
 * @param {{ onAccount: String | Object }} [opt={}] opt Options
 * @return {Promise<String>} Signature for delegation
 */
async function delegateOracleRegisterSignature (contractId, opt = {}) {
  return this.delegateSignatureCommon([contractId], opt)
}

/**
 * Helper to generate a signature to delegate a Oracle extend to a contract.
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} contractId Contract Id
 * @param {{ onAccount: String | Object }} [opt={}] opt Options
 * @return {Promise<String>} Signature for delegation
 */
async function delegateOracleExtendSignature (contractId, opt = {}) {
  return this.delegateSignatureCommon([contractId], opt)
}

/**
 * Helper to generate a signature to delegate a Oracle respond to a contract.
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @category async
 * @param {String} queryId Oracle Query Id
 * @param {String} contractId Contract Id
 * @param {{ onAccount: String | Object }} [opt={}] opt Options
 * @return {Promise<String>} Signature for delegation
 */
async function delegateOracleRespondSignature (queryId, contractId, opt = {}) {
  return this.delegateSignatureCommon([queryId, contractId], opt)
}

/**
 * Contract Stamp
 *
 * Provide contract implementation
 * {@link module:@aeternity/aepp-sdk/es/ae--Ae} clients.
 * @function
 * @alias module:@aeternity/aepp-sdk/es/ae/contract
 * @rtype Stamp
 * @param {Object} [options={}] - Initializer object
 * @return {Object} Contract instance
 * @example
 * import Transaction from '@aeternity/aepp-sdk/es/tx/tx
 * import MemoryAccount from '@aeternity/aepp-sdk/es/account/memory
 * import ChainNode from '@aeternity/aepp-sdk/es/chain/node
 * import ContractCompilerAPI from '@aeternity/aepp-sdk/es/contract/compiler
 * // or using bundle
 * import {
 *   Transaction,
 *   MemoryAccount,
 *   ChainNode,
 *   ContractCompilerAPI
 * } from '@aeternity/aepp-sdk
 *
 * const ContractWithAE = await Contract
 *    .compose(Transaction, MemoryAccount, ChainNode) // AE implementation
 *    .compose(ContractCompilerAPI) // ContractBase implementation
 * const client = await ContractWithAe({ url, internalUrl, compilerUrl, keypair, ... })
 *
 */
export const ContractAPI = Ae.compose(ContractBase, {
  methods: {
    getContractInstance,
    contractCompile,
    contractCallStatic,
    contractDeploy,
    contractCall,
    contractEncodeCall,
    contractDecodeData,
    _handleCallError,
    _sendAndProcess,
    // Delegation for contract
    delegateSignatureCommon,
    // AENS
    createAensDelegationSignature,
    // Oracle
    delegateOracleRegisterSignature,
    delegateOracleExtendSignature,
    delegateOracleRespondSignature
  },
  deepProps: {
    Ae: {
      defaults: {
        deposit: DEPOSIT,
        gasPrice: MIN_GAS_PRICE,
        amount: AMOUNT,
        gas: GAS
      }
    }
  }
})

export const Contract = ContractAPI.compose(NodePool)
export const ContractWithCompiler = Contract.compose(ContractCompilerAPI)
export default ContractWithCompiler
