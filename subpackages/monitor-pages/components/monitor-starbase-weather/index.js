Component({
  options: {
    virtualHost: true,
    styleIsolation: 'apply-shared'
  },
  properties: {
    weather: { type: Object, value: {} }
  }
})
