import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['src/**/*.ts'],
	splitting: true,
	outDir: 'dist',
	target: 'node20',
	format: 'esm',
	dts: true,
	cjsInterop: false
})
