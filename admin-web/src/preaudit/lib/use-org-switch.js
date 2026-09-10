import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getOrg, normalize } from './org.js'
import { switchProjectOrg } from './store.js'

export function useOrgSwitch(getProject) {
  const open = ref(false)

  const openOrgSwitch = () => {
    open.value = true
  }

  const closeOrgSwitch = () => {
    open.value = false
  }

  const pickOrg = (orgType) => {
    const project = typeof getProject === 'function' ? getProject() : (getProject && getProject.value)
    if (!project || !project.id) return
    const next = normalize(orgType)
    if (normalize(project.orgType) === next) {
      open.value = false
      return
    }
    const saved = switchProjectOrg(project.id, next)
    if (!saved) {
      ElMessage.error('换类型失败，请再试一次')
      return
    }
    ElMessage.success('已换成' + getOrg(next).title + '，施工照片还在')
    open.value = false
  }

  return { orgSwitchOpen: open, openOrgSwitch, closeOrgSwitch, pickOrg }
}
