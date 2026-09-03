export const ORGS = {
  village: {
    id: 'village',
    name: '村委会',
    short: '村里',
    title: '村委会报账',
    accent: 'village',
    placeLabel: '自然村 / 村组',
    contractorLabel: '施工单位 / 中标单位'
  },
  small: {
    id: 'small',
    name: '村委会小额',
    short: '小额',
    title: '村委会小额报账',
    accent: 'small',
    placeLabel: '自然村 / 村组',
    contractorLabel: '供货 / 实施单位'
  },
  township: {
    id: 'township',
    name: '乡政府',
    short: '乡里',
    title: '乡政府报账',
    accent: 'town',
    placeLabel: '承办股室 / 使用单位',
    contractorLabel: '实施单位'
  }
}

export function normalize(value) {
  if (value === 'township' || value === 'small') return value
  return 'village'
}

export function getOrg(value) {
  return ORGS[normalize(value)]
}

export function fromProject(project) {
  return getOrg(project && project.orgType)
}
