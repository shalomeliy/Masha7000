import { describe, expect, it } from 'vitest'
import { cleanVehicle, hasSamples, jobVehicleText, pickModel, pickVehicle, randomPlate, sampleVehicles, shownValue, STARTER_VEHICLE_FIELDS, vehicleError, vehicleExpiries, vehicleModels, vehiclesOfModel, withFixedFields, worstExpiry } from './vehicles'
import type { Vehicle } from '../types/models'

const v = (id: string, plate: string, model = ''): Vehicle => ({ id, values: { plate, ...(model ? { model } : {}) } })
const fleet = [v('1', '12-345-67', 'הילוקס'), v('2', '22-222-22', 'אקטרוס'), v('3', '33-333-33', 'הילוקס')]

describe('vehicles', () => {
  it('starts with 10 fields, and plate and model are always first', () => {
    expect(STARTER_VEHICLE_FIELDS).toHaveLength(10)
    expect(withFixedFields([{ id: 'km', name: 'ק"מ' }]).map((f) => f.id)).toEqual(['plate', 'model', 'km'])
    expect(withFixedFields([{ id: 'model', name: 'דגם' }, { id: 'plate', name: 'רישוי' }, { id: 'type', name: 'סוג' }]).map((f) => f.name)).toEqual(['רישוי', 'דגם', 'סוג'])
  })

  it('needs a plate, and the same plate twice is refused whatever the dashes', () => {
    expect(vehicleError(v('9', ' '), fleet)).toBe('צריך למלא מספר רישוי')
    expect(vehicleError(v('9', '1234567'), fleet)).toBe('רכב עם מספר הרישוי הזה כבר קיים')
    expect(vehicleError(v('1', '12-345-67'), fleet)).toBeNull()
    expect(cleanVehicle({ id: 'x', values: { plate: ' 1 ', km: '  ' } }).values).toEqual({ plate: '1' })
  })

  it('a model narrows the plates, a plate brings its model', () => {
    expect(vehicleModels(fleet)).toEqual(['אקטרוס', 'הילוקס'])
    expect(vehiclesOfModel(fleet, 'הילוקס').map((x) => x.id)).toEqual(['1', '3'])
    expect(pickVehicle('2', fleet)).toEqual({ vehicleId: '2', vehicleModel: 'אקטרוס' })
    expect(pickModel({ vehicleId: '2' }, 'הילוקס', fleet)).toEqual({ vehicleModel: 'הילוקס', vehicleId: undefined })
    expect(pickModel({ vehicleId: '1' }, 'הילוקס', fleet)).toEqual({ vehicleModel: 'הילוקס', vehicleId: '1' })
    expect(jobVehicleText({ vehicleId: '1' }, fleet)).toBe('12-345-67 · הילוקס')
    expect(jobVehicleText({ vehicleId: 'gone' }, fleet)).toBe('רכב שנמחק')
    expect(jobVehicleText({ vehicleModel: 'אקטרוס' }, fleet)).toBe('אקטרוס')
  })
})

describe('vehicle expiry and example vehicles', () => {
  const fields = STARTER_VEHICLE_FIELDS
  const today = '2026-11-14'
  const car = (values: Record<string, string>): Vehicle => ({ id: 'c', values: { plate: '1', ...values } })

  it('red for a passed or missing test/insurance date, orange within 30 days, nothing further out', () => {
    expect(vehicleExpiries(car({ testUntil: '2026-11-13', insuranceUntil: '2027-05-01' }), fields, today).map((e) => [e.fieldId, e.state])).toEqual([['testUntil', 'expired']])
    expect(vehicleExpiries(car({ insuranceUntil: '2027-05-01' }), fields, today).map((e) => e.state)).toEqual(['missing'])
    const soon = vehicleExpiries(car({ testUntil: '2026-12-14', insuranceUntil: '2026-12-15' }), fields, today)
    expect(soon.map((e) => [e.fieldId, e.state])).toEqual([['testUntil', 'soon']])
    expect(worstExpiry(soon)).toBe('orange')
    expect(worstExpiry([...soon, { fieldId: 'x', name: 'x', state: 'missing' }])).toBe('red')
    expect(worstExpiry([])).toBeNull()
  })

  it('makes fourteen example vehicles with Israeli plates, new plates, the dates mix and workers as drivers', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const list = sampleVehicles(today, fleet, ['w1', 'w2'], rand)
    expect(list).toHaveLength(14)
    expect(hasSamples(list)).toBe(true)
    expect(hasSamples(fleet)).toBe(false)
    for (const x of list) expect(x.values.plate).toMatch(/^(\d{2}-\d{3}-\d{2}|\d{3}-\d{2}-\d{3})$/)
    expect(new Set(list.map((x) => x.values.plate)).size).toBe(14)
    const states = list.map((x) => worstExpiry(vehicleExpiries(x, fields, today)))
    expect(states.filter((s) => s === 'red').length).toBeGreaterThanOrEqual(3)
    expect(states.filter((s) => s === 'orange').length).toBeGreaterThanOrEqual(2)
    expect(states.filter((s) => s === null).length).toBe(5)
    expect(list.filter((x) => x.values.driver).every((x) => ['w1', 'w2'].includes(x.values.driver))).toBe(true)
    expect(sampleVehicles(today, [], [], rand).some((x) => x.values.driver)).toBe(false)
  })

  it('shows the driver by the worker\'s full name, and an old typed name as is', () => {
    const workers = [{ id: 'w1', firstName: 'דני', lastName: 'כהן' }]
    expect(shownValue(car({ driver: 'w1' }), 'driver', workers)).toBe('דני כהן')
    expect(shownValue(car({ driver: 'משה' }), 'driver', workers)).toBe('משה')
    expect(randomPlate(() => 0.1)).toBe('11-111-11')
  })
})
