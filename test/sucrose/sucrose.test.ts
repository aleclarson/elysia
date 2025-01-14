import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

import { separateFunction, sucrose } from '../../src/sucrose'
import { req } from '../utils'

describe('sucrose', () => {
	it('common 1', () => {
		expect(
			sucrose({
				handler: function ({ query }) {
					query.a
				},
				afterHandle: [],
				beforeHandle: [],
				error: [
					function a({
						query,
						query: { a, c: d },
						headers: { hello },
						...rest
					}) {
						query.b
						rest.query.e
					},
					({ query: { f } }) => {}
				],
				mapResponse: [],
				onResponse: [],
				parse: [],
				request: [],
				start: [],
				stop: [],
				trace: [],
				transform: []
			})
		).toEqual({
			queries: ['a', 'e', 'b', 'c', 'f'],
			query: true,
			headers: true,
			body: false,
			cookie: false,
			set: false,
			unknownQueries: false
		})
	})

	it('integration 1', async () => {
		const path = 'a'

		const app = new Elysia()
			// ✅ easy to perform inference
			.get('/1', ({ query: { a } }) => a)
			.get('/2', ({ query }) => query.a)
			.get('/3', (c) => c.query.a)
			.get('/4', ({ query }) => query[path])
			.get('/5', (c) => c.query[path])

		addEventListener('fetch', (request) => {
			console.log(request)
		})

		new Array(5).fill(0).map(async (_, i) => {
			const result = await app
				.handle(req(`/${i + 1}?a=a&b=b`))
				.then((x) => x.text())

			expect(result).toBe('a')
		})
	})

	it("don't link object inference", () => {
		const app = new Elysia({ precompile: true })
			.get('/', 'Hi')
			.get('/id/:id', ({ set, params: { id }, query: { name } }) => {
				set.headers['x-powered-by'] = 'benchmark'

				return id + ' ' + name
			})

		// @ts-expect-error
		expect(app.inference).toEqual({
			event: {
				body: false,
				cookie: false,
				headers: false,
				queries: [],
				query: false,
				set: false,
				unknownQueries: false
			},
			trace: {
				request: false,
				parse: false,
				transform: false,
				handle: false,
				beforeHandle: false,
				afterHandle: false,
				error: false,
				context: false,
				store: false,
				set: false
			}
		})
	})

	it('inherits inference from plugin', () => {
		const plugin = new Elysia().derive(({ headers: { authorization } }) => {
			return {
				get auth() {
					return authorization
				}
			}
		})

		const main = new Elysia().use(plugin)

		// @ts-expect-error
		expect(main.inference.event.headers).toBe(true)
	})
})
