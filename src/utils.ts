import { Any, Kind, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { TypeCheck, TypeCompiler } from '@sinclair/typebox/compiler'

import { t } from '.'
import { isNotEmpty } from './handler'

import type {
	LifeCycleStore,
	LocalHook,
	MaybeArray,
	InputSchema,
	BaseMacro,
	ElysiaFn,
	LifeCycleType
} from './types'
import type { CookieOptions } from './cookies'

export const replaceUrlPath = (url: string, pathname: string) => {
	const urlObject = new URL(url)
	urlObject.pathname = pathname
	return urlObject.toString()
}

const isClass = (v: Object) =>
	(typeof v === 'function' && /^\s*class\s+/.test(v.toString())) ||
	// Handle import * as Sentry from '@sentry/bun'
	// This also handle [object Date], [object Array]
	// and FFI value like [object Prisma]
	v.toString().startsWith('[object ') ||
	// If object prototype is not pure, then probably a class-like object
	isNotEmpty(Object.getPrototypeOf(v))

const isObject = (item: any): item is Object =>
	item && typeof item === 'object' && !Array.isArray(item)

export const mergeDeep = <
	A extends Record<string, any>,
	B extends Record<string, any>
>(
	target: A,
	source: B,
	{
		skipKeys
	}: {
		skipKeys?: string[]
	} = {}
): A & B => {
	if (isObject(target) && isObject(source))
		for (const [key, value] of Object.entries(source)) {
			if (skipKeys?.includes(key)) continue

			if (!isObject(value) || !(key in target) || isClass(value)) {
				target[key as keyof typeof target] = value
				continue
			}

			target[key as keyof typeof target] = mergeDeep(
				(target as any)[key] as any,
				value
			)
		}

	return target as A & B
}
export const mergeCookie = <const A extends Object, const B extends Object>(
	a: A,
	b: B
): A & B => {
	// @ts-ignore
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { properties: _, ...target } = a ?? {}

	// @ts-ignore
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { properties: __, ...source } = b ?? {}

	return mergeDeep(target, source) as A & B
}

export const mergeObjectArray = <T extends ElysiaFn>(
	a: T | T[] = [],
	b: T | T[] = []
): T[] => {
	if (!a) return []

	// ! Must copy to remove side-effect
	const array = <T[]>[]
	const checksums = <(number | undefined)[]>[]

	if (!Array.isArray(a)) a = [a]
	if (!Array.isArray(b)) b = [b]

	for (const item of a) {
		array.push(item)

		if (item.$elysiaChecksum) checksums.push(item.$elysiaChecksum)
	}

	for (const item of b)
		if (!checksums.includes(item?.$elysiaChecksum)) array.push(item)

	return array
}

export const primitiveHooks = [
	'start',
	'request',
	'parse',
	'transform',
	'resolve',
	'beforeHandle',
	'afterHandle',
	'onResponse',
	'mapResponse',
	'trace',
	'error',
	'stop',
	'body',
	'headers',
	'params',
	'query',
	'response',
	'type',
	'detail'
] as const

const primitiveHookMap = primitiveHooks.reduce(
	(acc, x) => ((acc[x] = true), acc),
	{} as Record<string, boolean>
)

export const mergeHook = (
	a?: LocalHook<any, any, any, any, any, any, any> | LifeCycleStore,
	b?: LocalHook<any, any, any, any, any, any, any>
): LifeCycleStore => {
	// In case if merging union is need
	// const customAStore: Record<string, unknown> = {}
	// const customBStore: Record<string, unknown> = {}

	// for (const [key, value] of Object.entries(a)) {
	// 	if (primitiveHooks.includes(key as any)) continue

	// 	customAStore[key] = value
	// }

	// for (const [key, value] of Object.entries(b)) {
	// 	if (primitiveHooks.includes(key as any)) continue

	// 	customBStore[key] = value
	// }

	// const unioned = Object.keys(customAStore).filter((x) =>
	// 	Object.keys(customBStore).includes(x)
	// )

	// // Must provide empty object to prevent reference side-effect
	// const customStore = Object.assign({}, customAStore, customBStore)

	// for (const union of unioned)
	// 	customStore[union] = mergeObjectArray(
	// 		customAStore[union],
	// 		customBStore[union]
	// 	)

	return {
		...a,
		...b,
		// Merge local hook first
		// @ts-ignore
		body: b?.body ?? a?.body,
		// @ts-ignore
		headers: b?.headers ?? a?.headers,
		// @ts-ignore
		params: b?.params ?? a?.params,
		// @ts-ignore
		query: b?.query ?? a?.query,
		// @ts-ignore
		response: b?.response ?? a?.response,
		type: a?.type || b?.type,
		detail: mergeDeep(
			// @ts-ignore
			b?.detail ?? {},
			// @ts-ignore
			a?.detail ?? {}
		),
		parse: mergeObjectArray(a?.parse as any, b?.parse),
		transform: mergeObjectArray(a?.transform, b?.transform),
		beforeHandle: mergeObjectArray(a?.beforeHandle, b?.beforeHandle),
		afterHandle: mergeObjectArray(a?.afterHandle, b?.afterHandle),
		onResponse: mergeObjectArray(a?.onResponse, b?.onResponse) as any,
		mapResponse: mergeObjectArray(a?.mapResponse, b?.mapResponse) as any,
		trace: mergeObjectArray(a?.trace, b?.trace) as any,
		error: mergeObjectArray(a?.error, b?.error)
	}
}

export const getSchemaValidator = (
	s: TSchema | string | undefined,
	{
		models = {},
		additionalProperties = false,
		dynamic = false
	}: {
		models?: Record<string, TSchema>
		additionalProperties?: boolean
		dynamic?: boolean
	}
) => {
	if (!s) return
	if (typeof s === 'string' && !(s in models)) return

	const schema: TSchema = typeof s === 'string' ? models[s] : s

	// @ts-ignore
	if (schema.type === 'object' && 'additionalProperties' in schema === false)
		schema.additionalProperties = additionalProperties

	if (dynamic)
		return {
			schema,
			references: '',
			checkFunc: () => {},
			code: '',
			Check: (value: unknown) => Value.Check(schema, value),
			Errors: (value: unknown) => Value.Errors(schema, value),
			Code: () => ''
		} as unknown as TypeCheck<TSchema>

	try {
		return TypeCompiler.Compile(schema, Object.values(models))
	} catch (error) {
		console.error('Error compiling schema', s, error)
		return
	}
}

export const getResponseSchemaValidator = (
	s: InputSchema['response'] | undefined,
	{
		models = {},
		additionalProperties = false,
		dynamic = false
	}: {
		models?: Record<string, TSchema>
		additionalProperties?: boolean
		dynamic?: boolean
	}
): Record<number, TypeCheck<any>> | undefined => {
	if (!s) return
	if (typeof s === 'string' && !(s in models)) return

	const maybeSchemaOrRecord = typeof s === 'string' ? models[s] : s

	const compile = (schema: TSchema, references?: TSchema[]) => {
		if (dynamic)
			return {
				schema,
				references: '',
				checkFunc: () => {},
				code: '',
				Check: (value: unknown) => Value.Check(schema, value),
				Errors: (value: unknown) => Value.Errors(schema, value),
				Code: () => ''
			} as unknown as TypeCheck<TSchema>

		try {
			return TypeCompiler.Compile(schema, references)
		} catch (error) {
			console.error('Error compiling schema', schema, error)
			return TypeCompiler.Compile(Any())
		}
	}

	if (Kind in maybeSchemaOrRecord) {
		if ('additionalProperties' in maybeSchemaOrRecord === false)
			maybeSchemaOrRecord.additionalProperties = additionalProperties

		return {
			200: compile(maybeSchemaOrRecord, Object.values(models))
		}
	}

	const record: Record<number, TypeCheck<any>> = {}

	Object.keys(maybeSchemaOrRecord).forEach((status): TSchema | undefined => {
		const maybeNameOrSchema = maybeSchemaOrRecord[+status]

		if (typeof maybeNameOrSchema === 'string') {
			if (maybeNameOrSchema in models) {
				const schema = models[maybeNameOrSchema]
				schema.type === 'object' &&
					'additionalProperties' in schema === false

				// Inherits model maybe already compiled
				record[+status] =
					Kind in schema
						? compile(schema, Object.values(models))
						: schema
			}

			return undefined
		}

		if (
			maybeNameOrSchema.type === 'object' &&
			'additionalProperties' in maybeNameOrSchema === false
		)
			maybeNameOrSchema.additionalProperties = additionalProperties

		// Inherits model maybe already compiled
		record[+status] =
			Kind in maybeNameOrSchema
				? compile(maybeNameOrSchema, Object.values(models))
				: maybeNameOrSchema
	})

	return record
}

const isBun = typeof Bun !== 'undefined'
const hasHash = isBun && typeof Bun.hash === 'function'

// https://stackoverflow.com/a/52171480
export const checksum = (s: string) => {
	if (hasHash) return Bun.hash(s) as number

	let h = 9

	for (let i = 0; i < s.length; ) h = Math.imul(h ^ s.charCodeAt(i++), 9 ** 9)

	return (h = h ^ (h >>> 9))
}

export const getCookieValidator = ({
	validator,
	defaultConfig = {},
	config,
	dynamic,
	models
}: {
	validator: TSchema | string | undefined
	defaultConfig: CookieOptions | undefined
	config: CookieOptions
	dynamic: boolean
	models: Record<string, TSchema> | undefined
}) => {
	let cookieValidator = getSchemaValidator(validator, {
		dynamic,
		models,
		additionalProperties: true
	})

	if (isNotEmpty(defaultConfig)) {
		if (cookieValidator) {
			// @ts-expect-error private
			cookieValidator.schema = mergeCookie(
				// @ts-expect-error private
				cookieValidator.schema,
				config
			)
		} else {
			cookieValidator = getSchemaValidator(t.Cookie({}, defaultConfig), {
				dynamic,
				models,
				additionalProperties: true
			})
		}
	}

	return cookieValidator
}

export const mergeLifeCycle = (
	a: LifeCycleStore,
	b: LifeCycleStore | LocalHook<any, any, any, any, any, any, any>,
	checksum?: number
): LifeCycleStore => {
	const injectChecksum = (x: MaybeArray<ElysiaFn> | undefined) => {
		if (!x) return

		if (!Array.isArray(x)) {
			// ? clone fn is required to prevent side-effect from changing hookType
			const fn = x

			if (checksum && !fn.$elysiaChecksum) fn.$elysiaChecksum = checksum
			if (fn.$elysiaHookType === 'scoped') fn.$elysiaHookType = 'local'

			return fn
		}

		// ? clone fns is required to prevent side-effect from changing hookType
		const fns = [...x]

		for (const fn of fns) {
			if (checksum && !fn.$elysiaChecksum) fn.$elysiaChecksum = checksum

			if (fn.$elysiaHookType === 'scoped') fn.$elysiaHookType = 'local'
		}

		return fns
	}

	return {
		...a,
		...b,
		start: mergeObjectArray(a.start, injectChecksum(b?.start)),
		request: mergeObjectArray(a.request, injectChecksum(b?.request)),
		parse: mergeObjectArray(a.parse, injectChecksum(b?.parse)),
		transform: mergeObjectArray(a.transform, injectChecksum(b?.transform)),
		beforeHandle: mergeObjectArray(
			a.beforeHandle,
			injectChecksum(b?.beforeHandle)
		),
		afterHandle: mergeObjectArray(
			a.afterHandle,
			injectChecksum(b?.afterHandle)
		),
		mapResponse: mergeObjectArray(
			a.mapResponse,
			injectChecksum(b?.mapResponse)
		),
		onResponse: mergeObjectArray(
			a.onResponse,
			injectChecksum(b?.onResponse)
		),
		// Already merged on Elysia._use, also logic is more complicated, can't directly merge
		trace: a.trace,
		error: mergeObjectArray(a.error, injectChecksum(b?.error)),
		stop: mergeObjectArray(a.stop, injectChecksum(b?.stop))
	}
}

export const asHookType = <T extends MaybeArray<ElysiaFn> | undefined>(
	fn: T,
	inject: LifeCycleType,
	{ skipIfHasType = false }: { skipIfHasType?: boolean } = {}
): T => {
	if (!fn) return fn

	if (typeof fn === 'function') {
		if (skipIfHasType) fn.$elysiaHookType ??= inject
		else fn.$elysiaHookType = inject

		return fn
	}

	if (!Array.isArray(fn)) return fn

	for (const x of fn)
		if (skipIfHasType) x.$elysiaHookType ??= inject
		else x.$elysiaHookType = inject

	return fn
}

const filterGlobal = <T extends MaybeArray<ElysiaFn> | undefined>(
	fn: T
): T | undefined => {
	if (!fn) return fn

	if (typeof fn === 'function')
		switch (fn.$elysiaHookType) {
			case 'global':
			case 'scoped':
				return fn

			default:
				return undefined
		}

	if (!Array.isArray(fn)) return <any>[]

	const array = <any>[]

	for (const x of fn)
		switch (x.$elysiaHookType) {
			case 'global':
			case 'scoped':
				array.push(x)
				break
		}

	return array as T
}

export const filterGlobalHook = (
	hook: LocalHook<any, any, any, any, any, any, any>
): LocalHook<any, any, any, any, any, any, any> => {
	return {
		// rest is validator
		...hook,
		type: hook?.type,
		detail: hook?.detail,
		parse: filterGlobal(hook?.parse),
		transform: filterGlobal(hook?.transform),
		beforeHandle: filterGlobal(hook?.beforeHandle),
		afterHandle: filterGlobal(hook?.afterHandle),
		onResponse: filterGlobal(hook?.onResponse),
		error: filterGlobal(hook?.error),
		mapResponse: filterGlobal(hook?.mapResponse)
	} as LocalHook<any, any, any, any, any, any, any>
}

export const StatusMap = {
	Continue: 100,
	'Switching Protocols': 101,
	Processing: 102,
	'Early Hints': 103,
	OK: 200,
	Created: 201,
	Accepted: 202,
	'Non-Authoritative Information': 203,
	'No Content': 204,
	'Reset Content': 205,
	'Partial Content': 206,
	'Multi-Status': 207,
	'Already Reported': 208,
	'Multiple Choices': 300,
	'Moved Permanently': 301,
	Found: 302,
	'See Other': 303,
	'Not Modified': 304,
	'Temporary Redirect': 307,
	'Permanent Redirect': 308,
	'Bad Request': 400,
	Unauthorized: 401,
	'Payment Required': 402,
	Forbidden: 403,
	'Not Found': 404,
	'Method Not Allowed': 405,
	'Not Acceptable': 406,
	'Proxy Authentication Required': 407,
	'Request Timeout': 408,
	Conflict: 409,
	Gone: 410,
	'Length Required': 411,
	'Precondition Failed': 412,
	'Payload Too Large': 413,
	'URI Too Long': 414,
	'Unsupported Media Type': 415,
	'Range Not Satisfiable': 416,
	'Expectation Failed': 417,
	"I'm a teapot": 418,
	'Misdirected Request': 421,
	'Unprocessable Content': 422,
	Locked: 423,
	'Failed Dependency': 424,
	'Too Early': 425,
	'Upgrade Required': 426,
	'Precondition Required': 428,
	'Too Many Requests': 429,
	'Request Header Fields Too Large': 431,
	'Unavailable For Legal Reasons': 451,
	'Internal Server Error': 500,
	'Not Implemented': 501,
	'Bad Gateway': 502,
	'Service Unavailable': 503,
	'Gateway Timeout': 504,
	'HTTP Version Not Supported': 505,
	'Variant Also Negotiates': 506,
	'Insufficient Storage': 507,
	'Loop Detected': 508,
	'Not Extended': 510,
	'Network Authentication Required': 511
} as const

export const InvertedStatusMap = Object.fromEntries(
	Object.entries(StatusMap).map(([k, v]) => [v, k])
) as {
	[K in keyof StatusMap as StatusMap[K]]: K
}

export type StatusMap = typeof StatusMap
export type InvertedStatusMap = typeof InvertedStatusMap

function removeTrailingEquals(digest: string): string {
	let trimmedDigest = digest
	while (trimmedDigest.endsWith('=')) {
		trimmedDigest = trimmedDigest.slice(0, -1)
	}
	return trimmedDigest
}

const encoder = new TextEncoder()

export const signCookie = async (val: string, secret: string | null) => {
	if (typeof val !== 'string')
		throw new TypeError('Cookie value must be provided as a string.')

	if (secret === null) throw new TypeError('Secret key must be provided.')

	const secretKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	)
	const hmacBuffer = await crypto.subtle.sign(
		'HMAC',
		secretKey,
		encoder.encode(val)
	)

	return (
		val +
		'.' +
		removeTrailingEquals(Buffer.from(hmacBuffer).toString('base64'))
	)
}

export const unsignCookie = async (input: string, secret: string | null) => {
	if (typeof input !== 'string')
		throw new TypeError('Signed cookie string must be provided.')

	if (null === secret) throw new TypeError('Secret key must be provided.')

	const tentativeValue = input.slice(0, input.lastIndexOf('.'))
	const expectedInput = await signCookie(tentativeValue, secret)

	return expectedInput === input ? tentativeValue : false
}

export const traceBackMacro = (
	extension: unknown,
	property: Record<string, unknown>,
	hooks = property
) => {
	if (!extension || typeof extension !== 'object' || !property) return

	for (const [key, value] of Object.entries(property)) {
		if (key in primitiveHookMap || !(key in extension)) continue

		const v = extension[
			key as unknown as keyof typeof extension
		] as BaseMacro[string]

		if (typeof v === 'function') {
			v(value)
		} else if (typeof v === 'object')
			traceBackMacro(v as BaseMacro, value as any, hooks)
	}
}

export const createMacroManager =
	({
		globalHook,
		localHook
	}: {
		globalHook: LifeCycleStore
		localHook: LocalHook<any, any, any, any, any, any, any>
	}) =>
	(stackName: keyof LifeCycleStore) =>
	(
		type:
			| {
					insert?: 'before' | 'after'
					stack?: 'global' | 'local'
			  }
			| MaybeArray<Function>,
		fn?: MaybeArray<Function>
	) => {
		if (typeof type === 'function' || Array.isArray(type)) {
			if (!localHook[stackName]) localHook[stackName] = []
			if (typeof localHook[stackName] === 'function')
				localHook[stackName] = [localHook[stackName]]

			if (Array.isArray(type))
				localHook[stackName] = (
					localHook[stackName] as unknown[]
				).concat(type) as any
			else localHook[stackName].push(type)

			return
		}

		const { insert = 'after', stack = 'local' } = type

		if (stack === 'global') {
			if (!Array.isArray(fn)) {
				if (insert === 'before') {
					;(globalHook[stackName] as any[]).unshift(fn)
				} else {
					;(globalHook[stackName] as any[]).push(fn)
				}
			} else {
				if (insert === 'before') {
					globalHook[stackName] = fn.concat(
						globalHook[stackName] as any
					) as any
				} else {
					globalHook[stackName] = (
						globalHook[stackName] as any[]
					).concat(fn)
				}
			}
		} else {
			if (!localHook[stackName]) localHook[stackName] = []
			if (typeof localHook[stackName] === 'function')
				localHook[stackName] = [localHook[stackName]]

			if (!Array.isArray(fn)) {
				if (insert === 'before') {
					;(localHook[stackName] as any[]).unshift(fn)
				} else {
					;(localHook[stackName] as any[]).push(fn)
				}
			} else {
				if (insert === 'before') {
					localHook[stackName] = fn.concat(localHook[stackName])
				} else {
					localHook[stackName] = localHook[stackName].concat(fn)
				}
			}
		}
	}

export const isNumericString = (message: string): boolean => {
	if (message.length < 16)
		return message.trim().length !== 0 && !Number.isNaN(Number(message))

	// if 16 digit but less then 9,007,199,254,740,991 then can be parsed
	if (message.length === 16) {
		const numVal = Number(message)
		if (numVal.toString() === message)
			return message.trim().length !== 0 && !Number.isNaN(numVal)
	}

	return false
}
