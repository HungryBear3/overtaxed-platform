/** @jest-environment node */
import { readFileSync } from 'node:fs'

const mockConfigs: any[] = []
const mockQueryRaw = jest.fn()
jest.mock('pg', () => ({ Pool: function(config: any) { mockConfigs.push(config); return {on: jest.fn(), end: jest.fn()} } }))
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: function() {} }))
jest.mock('@prisma/client', () => ({ PrismaClient: function() { return {$transaction: (fn: any) => fn({$queryRaw: mockQueryRaw})} } }))
const host = 'aws-0-us-east-2.pooler.supabase.com', project = 'iyaxdrehtxsfkaexgxls'
const ca = readFileSync(__dirname + '/fixtures/supabase-root.crt', 'utf8')
const original = {...process.env}
const roles = ['ot_factual_app', 'ot_paid_snapshot_binder', 'ot_paid_snapshot_reader']
const url = (role: string, h = host) => `postgresql://${role}@${h}:5432/postgres`
function snapshot() { return require('@/lib/evidence/server/acquisition-snapshot') }
function factual() { return require('@/lib/evidence/server/factual-db') }
beforeEach(() => {
 jest.resetModules(); mockConfigs.length = 0; process.env = {...original,
 OT_ROLE_DATABASE_HOST: host, OT_ROLE_DATABASE_PROJECT_REF: project, OT_ROLE_DATABASE_CA: ca,
 OT_FACTUAL_DATABASE_SSL: 'require', OT_FACTUAL_DATABASE_URL: url(`ot_factual_app.${project}`)}
 mockQueryRaw.mockResolvedValue([{current_user:'ot_factual_app',rolsuper:false,rolbypassrls:false}])
})
afterAll(() => {process.env=original})
test.each(roles)('actual snapshot constructor accepts pinned wire %s', role => {
 snapshot().snapshotRolePool(url(`${role}.${project}`),role,'require')
 const c = mockConfigs[0]; expect(c.connectionString).toBe(url(`${role}.${project}`))
 expect(c.ssl).toEqual(expect.objectContaining({rejectUnauthorized:true,servername:host,ca}))
 expect(c.ssl.checkServerIdentity('ignored', {subjectaltname:'DNS:wrong.example'})).toMatchObject({code:'ERR_TLS_CERT_ALTNAME_INVALID'})
 expect(c.ssl.checkServerIdentity('ignored', {subjectaltname:`DNS:${host}`})).toBeUndefined()
})
test.each(roles)('direct bare role %s with exact project host', role => {
 const h=`db.${project}.supabase.co`; process.env.OT_ROLE_DATABASE_HOST=h
 snapshot().snapshotRolePool(url(role,h),role,'require')
 expect(mockConfigs[0].ssl.servername).toBe(h)
})
test('actual factual constructor accepts pooler transport and preserves guard', async () => {
 expect(await factual().withFactualTransaction(async()=>42)).toBe(42)
 expect(mockConfigs[0].ssl.ca).toBe(ca)
 expect(mockQueryRaw.mock.calls[0][0].join('')).toContain('session_user=current_user')
})
test.each(['wrong', 'ot_preview_app', `ot_factual_app.wrongproject`, `ot_factual_app.${project}.extra`])('wrong wire identity %s refused by both constructors', async role => {
 process.env.OT_FACTUAL_DATABASE_URL=url(role)
 expect(()=>snapshot().snapshotRolePool(url(role),'ot_factual_app','require')).toThrow()
 await expect(factual().withFactualTransaction(async()=>42)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'})
 expect(mockConfigs).toHaveLength(0)
})
test.each([
 ['host', {OT_ROLE_DATABASE_HOST:'other.pooler.supabase.com'}],
 ['project', {OT_ROLE_DATABASE_PROJECT_REF:'aaaaaaaaaaaaaaaaaaaa'}],
 ['wildcard project', {OT_ROLE_DATABASE_PROJECT_REF:'*'}],
 ['missing ca', {OT_ROLE_DATABASE_CA:''}],
 ['invalid ca', {OT_ROLE_DATABASE_CA:'not a certificate'}],
 ['disable', {OT_FACTUAL_DATABASE_SSL:'disable'}],
 ['invalid mode', {OT_FACTUAL_DATABASE_SSL:'prefer'}],
 ['ssl override', {OT_FACTUAL_DATABASE_URL:url(`ot_factual_app.${project}`)+'?sslmode=no-verify'}],
 ['user override', {OT_FACTUAL_DATABASE_URL:url(`ot_factual_app.${project}`)+'?user=ot_preview_app'}],
 ['host override', {OT_FACTUAL_DATABASE_URL:url(`ot_factual_app.${project}`)+'?host=wrong.example'}],
 ['role override', {OT_FACTUAL_DATABASE_URL:url(`ot_factual_app.${project}`)+'?options=-c%20role=ot_factual_app'}],
] as const)('hostile %s refuses before driver construction', async (_name, env) => {
 Object.assign(process.env,env)
 expect(()=>snapshot().snapshotRolePool(process.env.OT_FACTUAL_DATABASE_URL,'ot_factual_app',process.env.OT_FACTUAL_DATABASE_SSL)).toThrow()
 await expect(factual().withFactualTransaction(async()=>42)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'})
 expect(mockConfigs).toHaveLength(0)
})
test('factual direct bare role uses pinned strict TLS', async()=>{
 const h=`db.${project}.supabase.co`; process.env.OT_ROLE_DATABASE_HOST=h; process.env.OT_FACTUAL_DATABASE_URL=url('ot_factual_app',h)
 expect(await factual().withFactualTransaction(async()=>42)).toBe(42)
 expect(mockConfigs[0].ssl).toEqual(expect.objectContaining({ca,servername:h,rejectUnauthorized:true}))
})
test.each(['disable','prefer','missing-ca','bad-ca','host','project','query-user','query-ssl','query-host','query-options'])('bare direct hostile %s cannot hide behind suffix rejection', async kind=>{
 const h=`db.${project}.supabase.co`; process.env.OT_ROLE_DATABASE_HOST=h; process.env.OT_FACTUAL_DATABASE_URL=url('ot_factual_app',h)
 if(kind==='disable'||kind==='prefer')process.env.OT_FACTUAL_DATABASE_SSL=kind
 if(kind==='missing-ca')delete process.env.OT_ROLE_DATABASE_CA
 if(kind==='bad-ca')process.env.OT_ROLE_DATABASE_CA='-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----'
 if(kind==='host')process.env.OT_ROLE_DATABASE_HOST='wrong.example'
 if(kind==='project')process.env.OT_ROLE_DATABASE_PROJECT_REF='aaaaaaaaaaaaaaaaaaaa'
 const q: Record<string,string>={'query-user':'user=ot_preview_app','query-ssl':'sslmode=no-verify','query-host':'host=wrong.example','query-options':'options=-c%20role=ot_factual_app'}
 if(q[kind])process.env.OT_FACTUAL_DATABASE_URL+='?'+q[kind]
 expect(()=>snapshot().snapshotRolePool(process.env.OT_FACTUAL_DATABASE_URL,'ot_factual_app',process.env.OT_FACTUAL_DATABASE_SSL)).toThrow()
 await expect(factual().withFactualTransaction(async()=>42)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'})
 expect(mockConfigs).toHaveLength(0)
})
test('factual post-connect wrong identity never enters callback', async()=>{
 mockQueryRaw.mockResolvedValue([{current_user:'ot_preview_app',rolsuper:false,rolbypassrls:false}])
 const fn=jest.fn(); await expect(factual().withFactualTransaction(fn)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'}); expect(fn).not.toHaveBeenCalled()
})
test('retains explicit local Unix socket qualification route',()=>{
 for(const k of ['OT_ROLE_DATABASE_HOST','OT_ROLE_DATABASE_PROJECT_REF','OT_ROLE_DATABASE_CA'])delete process.env[k]
 snapshot().snapshotRolePool('postgresql://ot_factual_app@localhost/test?host=%2Fprivate%2Ftmp%2Fot-test','ot_factual_app','disable')
 expect(mockConfigs[0].ssl).toBe(false)
})
