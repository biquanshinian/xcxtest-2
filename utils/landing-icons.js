/**
 * utils/landing-icons.js
 * 助推器 / 飞船回收图标的内联 SVG 生成器
 *
 * 为什么不直接用 images/landing-*.svg 文件？
 *   小程序 <image> 标签加载的 SVG 文件无法用 CSS 控制 fill 颜色。
 *   而我们要根据 LL2 返回的 success / failure 状态动态变色（绿/橙/白），
 *   所以把同一份 SVG 路径数据存为字符串模板，运行时拼出对应颜色的 dataURI 给 <image> 用。
 *
 * 颜色规则（与 LL2 字段映射）：
 *   - success（landing.success === true）         → 绿色 #22c55e
 *   - failure（landing.success === false 或 LOST） → 橙色 #f97316
 *   - neutral（一次性使用 / 待确认 / 中性）        → 白色 #ffffff
 *
 * 颜色用 rgb() 写而不用 #hex —— 因为 # 在 dataURI 里要转义，rgb() 不需要，URL 更短
 */

const COLORS = {
  success: 'rgb(34,197,94)',   // tailwind green-500，与项目其它"成功"色一致
  failure: 'rgb(249,115,22)',  // tailwind orange-500，与项目其它"失败/警告"色一致
  neutral: 'rgb(255,255,255)'
}

// ${C} 是 fill 颜色占位符，buildLandingIcon 会替换成实际值
const TEMPLATES = {
  RTLS:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">'
    + '<path fill-rule="evenodd" fill="${C}" d="M 453 39 C 233 65 57 240 32 461 L 32 461 L 125 461 C 150 291 284 155 453 129 L 453 39 Z M 566 39 C 787 65 962 240 988 461 L 902 461 C 877 288 739 152 566 128 L 566 39 Z M 566 995 C 787 969 962 794 988 573 L 988 573 L 902 573 C 877 746 739 883 566 906 L 566 995 Z M 453 995 C 233 969 57 794 32 573 L 125 573 C 150 744 284 879 453 905 L 453 995 Z"/>'
    + '<path fill="${C}" d="M 401 385 L 271 385 L 264 399 L 387 492 C 414 476 443 457 475 441 M 518 583 L 645 675 L 775 675 L 780 663 L 592 524 C 567 544 541 563 518 583 Z"/>'
    + '<path fill="${C}" d="M 1307 229 C 1148 258 713 344 382 676 L 264 676 L 254 660 C 334 583 628 302 1333 217 C 1333 217 1358 221 1307 229 Z"/>'
    + '</svg>',

  ASDS:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">'
    + '<path fill="${C}" d="M 219 892 C 237 874 267 874 285 892 C 335 943 417 943 468 892 C 476 883 488 879 500 879 C 513 879 525 883 533 892 C 584 943 666 943 716 892 C 725 883 737 879 749 879 C 762 879 773 883 782 892 C 807 917 839 930 873 930 C 908 930 940 917 965 892 C 981 876 981 850 965 834 C 949 818 923 818 906 834 C 898 843 886 847 873 847 C 861 847 849 843 840 834 C 816 809 784 796 749 796 C 749 796 749 796 749 796 C 715 796 682 809 658 834 C 640 852 610 852 592 834 C 567 809 535 796 501 796 C 500 796 501 796 501 796 C 466 796 434 809 409 834 C 391 852 361 852 343 834 C 293 783 211 783 161 834 C 142 852 113 852 95 834 C 78 818 52 818 36 834 C 20 850 20 876 36 892 C 87 943 168 943 219 892 Z"/>'
    + '<path fill-rule="evenodd" fill="${C}" d="M 854 183 L 852 145 C 851 117 827 94 799 94 L 221 94 C 193 94 168 117 166 145 L 163 180 L 163 180 L 52 180 C 24 180 1 203 1 231 L 1 571 C 1 599 24 622 52 622 L 159 622 L 160 644 C 162 672 186 695 214 695 L 799 695 C 827 695 851 672 853 644 L 854 622 L 949 622 C 977 622 1000 599 1000 571 L 1000 231 C 1000 204 979 182 952 181 C 778 237 563 337 382 518 L 276 518 L 267 504 C 322 451 491 289 854 183 Z M 411 261 L 294 261 L 288 273 L 398 357 C 422 343 449 325 477 311 L 411 261 L 411 261 L 411 261 Z M 516 438 L 630 521 L 747 521 L 752 510 L 582 386 C 560 403 537 420 516 438 L 516 438 L 516 438 Z"/>'
    + '</svg>',

  // 海面/海上溅落（源自 images/landing-splashdown.svg；Super Heavy / Ship 共用）
  SPLASHDOWN:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<path fill="${C}" d="M20,12H22V14H20C18.62,14 17.26,13.65 16,13C13.5,14.3 10.5,14.3 8,13C6.74,13.65 5.37,14 4,14H2V12H4C5.39,12 6.78,11.53 8,10.67C10.44,12.38 13.56,12.38 16,10.67C17.22,11.53 18.61,12 20,12M20,6H22V8H20C18.62,8 17.26,7.65 16,7C13.5,8.3 10.5,8.3 8,7C6.74,7.65 5.37,8 4,8H2V6H4C5.39,6 6.78,5.53 8,4.67C10.44,6.38 13.56,6.38 16,4.67C17.22,5.53 18.61,6 20,6M20,18H22V20H20C18.62,20 17.26,19.65 16,19C13.5,20.3 10.5,20.3 8,19C6.74,19.65 5.37,20 4,20H2V18H4C5.39,18 6.78,17.53 8,16.67C10.44,18.38 13.56,18.38 16,16.67C17.22,17.53 18.61,18 20,18Z"/>'
    + '</svg>',

  EXPENDED:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<path fill="${C}" d="M17 19V22H15V19C15 17.9 14.1 17 13 17H10C7.2 17 5 14.8 5 12C5 10.8 5.4 9.8 6.1 8.9C3.8 8.5 2 6.4 2 4C2 3.3 2.2 2.6 2.4 2H4.8C4.3 2.5 4 3.2 4 4C4 5.7 5.3 7 7 7H10V9C8.3 9 7 10.3 7 12S8.3 15 10 15H13C15.2 15 17 16.8 17 19M17.9 8.9C20.2 8.5 22 6.4 22 4C22 3.3 21.8 2.6 21.6 2H19.2C19.7 2.5 20 3.2 20 4C20 5.7 18.7 7 17 7H15.8C15.9 7.3 16 7.6 16 8C16 9.7 14.7 11 13 11V13C15.8 13 18 15.2 18 18V22H20V18C20 15.3 18.5 13 16.2 11.8C17.1 11.1 17.7 10.1 17.9 8.9Z"/>'
    + '</svg>',

  // 龙飞船 / 载人龙飞船 / 货运龙飞船 等可回收飞船专用图标
  DRAGON:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<path fill="${C}" d="M6,6H18V9.96L12,8L6,9.96M3.94,19H4C5.6,19 7,18.12 8,17C9,18.12 10.4,19 12,19C13.6,19 15,18.12 16,17C17,18.12 18.4,19 20,19H20.05L21.95,12.31C22.03,12.06 22,11.78 21.89,11.54C21.76,11.3 21.55,11.12 21.29,11.04L20,10.62V6C20,4.89 19.1,4 18,4H15V1H9V4H6A2,2 0 0,0 4,6V10.62L2.71,11.04C2.45,11.12 2.24,11.3 2.11,11.54C2,11.78 1.97,12.06 2.05,12.31M20,21C18.61,21 17.22,20.53 16,19.67C13.56,21.38 10.44,21.38 8,19.67C6.78,20.53 5.39,21 4,21H2V23H4C5.37,23 6.74,22.65 8,22C10.5,23.3 13.5,23.3 16,22C17.26,22.65 18.62,23 20,23H22V21H20Z"/>'
    + '</svg>',

  // 塔架捕获（Mechazilla / Chopsticks）—— 源自 images/SPX_catch_tower.svg；Super Heavy / Ship 共用
  TOWER_CATCH:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><g><rect width="1000" height="1000" fill="none"/>'
    + '<path d=" M -13 789 L 840 478 L 981 526 L -7 896 L -13 789 Z  M 286 1012 L 961 770 L 973 796 L 327 1029 L 286 1012 Z  M 100 843" fill-rule="evenodd" fill="${C}"/>'
    + '<path d=" M 806 590 L 909 792 L 960 773 L 974 523 L 939 532 L 923 722 L 837 575 L 806 590 Z " fill="${C}"/>'
    + '<path d=" M 622 657 L 725 859 L 776 840 L 790 590 L 755 599 L 740 789 L 653 642 L 622 657 Z " fill="${C}"/>'
    + '<path d=" M 477 706 L 583 914 L 631 896 L 644 650 L 610 661 L 594 839 L 512 696 L 477 706 Z " fill="${C}"/>'
    + '<path d=" M 327 766 L 430 969 L 481 950 L 497 703 L 460 714 L 444 899 L 363 750 L 327 766 Z " fill="${C}"/>'
    + '<path d=" M 216 805 L 286 1018 L 337 999 L 350 759 L 316 770 L 300 948 L 248 792 L 216 805 Z " fill="${C}"/>'
    + '<path d=" M -363 451 L 393 173 L 541 223 L -363 557 L -363 451 Z  M -248 814 L -184 731 L 520 478 L 532 505 L -158 754 L -224 839 L -248 814 Z " fill-rule="evenodd" fill="${C}"/>'
    + '<path d=" M 358 290 L 465 501 L 518 481 L 533 220 L 496 230 L 480 428 L 390 274 L 358 290 Z " fill="${C}"/>'
    + '<path d=" M 166 360 L 274 571 L 327 551 L 342 290 L 305 300 L 289 498 L 199 344 L 166 360 Z " fill="${C}"/>'
    + '<path d=" M 15 411 L 125 628 L 175 609 L 188 353 L 153 364 L 137 550 L 51 401 L 15 411 Z " fill="${C}"/>'
    + '<path d=" M -142 474 L -34 685 L 19 665 L 35 408 L -3 420 L -19 612 L -105 457 L -142 474 Z " fill="${C}"/>'
    + '<path d=" M -258 514 L -184 736 L -131 717 L -118 467 L -153 478 L -170 664 L -224 501 L -258 514 Z " fill="${C}"/>'
    + '<path d=" M 645 128 C 677 170 678 218 661 261 C 697 225 718 181 703 137 C 702 131 700 126 700 120 L 699 113 L 701 113 L 710 132 C 722 166 724 201 712 237 C 688 309 719 378 776 434 C 750 367 753 290 806 221 C 816 208 824 195 831 182 L 835 173 L 835 175 C 824 221 848 262 887 294 C 866 253 863 205 893 159 C 917 112 923 53 904 10 C 874 -53 834 -82 780 -84 C 772 -84 764 -83 755 -82 C 711 -78 655 -56 638 -4 C 620 40 611 85 645 128 Z " fill="${C}"/>'
    + '</g></svg>',

  // 直升机捕获（Electron 等）—— 保留通用"捕获"箭头，不与 SpaceX 塔架图标混用
  HELICOPTER_CATCH:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<path fill="${C}" d="M11 2L5 8H9V13H7V15H17V13H15V8H19L13 2H11M7 17V20C7 21.1 7.9 22 9 22H15C16.1 22 17 21.1 17 20V17H7M9 19H15V20H9V19Z"/>'
    + '</svg>',

  // 网系回收（拦阻网驳船）—— 几何精简版；长征十号乙等
  NET_CATCH:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<path fill="${C}" d="M2 4h20v2H2V4zm0 5h20v2H2V9zm0 5h20v2H2v-2zm0 5h20v2H2v-2zM6 2v20h2V2H6zm5 0v20h2V2h-2zm5 0v20h2V2h-2z"/>'
    + '</svg>',

  // 蓝箭朱雀三号陆地回收（源自 images/landspace.svg；图形不变，仅按 status 换色）
  LANDSPACE:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0.17 0.17">'
    + '<path fill-rule="evenodd" fill="${C}" d="M-0 0l0.17 0 0 0.17 -0.17 0 0 -0.17zm0.09 0c0.05,0 0.08,0.04 0.08,0.08 0,0.05 -0.04,0.08 -0.08,0.08 -0.05,0 -0.08,-0.04 -0.08,-0.08 0,-0.05 0.04,-0.08 0.08,-0.08zm0 0.01c0.04,0 0.07,0.03 0.07,0.07 0,0.04 -0.03,0.07 -0.07,0.07 -0.04,0 -0.07,-0.03 -0.07,-0.07 0,-0.04 0.03,-0.07 0.07,-0.07zm0 0.03c0.03,0 0.05,0.02 0.05,0.05 0,0.03 -0.02,0.05 -0.05,0.05 -0.03,0 -0.05,-0.02 -0.05,-0.05 0,-0.03 0.02,-0.05 0.05,-0.05zm0 0.01c0.02,0 0.04,0.02 0.04,0.04 0,0.02 -0.02,0.04 -0.04,0.04 -0.02,0 -0.04,-0.02 -0.04,-0.04 0,-0.02 0.02,-0.04 0.04,-0.04z"/>'
    + '</svg>',

  // 蓝色起源新格伦 LPV1 / Jacklyn 海上回收 —— 几何精简版（驳船 + RTLS 角标）
  BO_LZ:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    + '<path fill="${C}" d="M32 6C16 10 7 26 4 42h11c3-11 12-21 24-24V6zm36 0c16 4 25 20 28 36H85c-3-13-13-23-25-25V6zM68 94c16-4 25-20 28-36H85c-3 13-13 23-25 25v11zM32 94C16 90 7 74 4 58h11c3 11 12 21 24 24V94z"/>'
    + '<path fill="${C}" d="M18 56h64v9H18zm6-11h52v13H24z"/>'
    + '<path fill="${C}" d="M14 72c4-3 8-3 12 0s8 3 12 0 8-3 12 0 8 3 12 0 8-3 12 0v5c-4 3-8 3-12 0s-8-3-12 0-8 3-12 0-8-3-12 0-8 3-12 0v-5z"/>'
    + '</svg>',

  // 水平跑道着陆（空天飞机 / CSSHQ 等）—— 源自用户提供的着陆图标 path
  HL:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<path fill="${C}" d="M2.5,19H21.5V21H2.5V19M9.68,13.27L14.03,14.43L19.34,15.85C20.14,16.06 20.96,15.59 21.18,14.79C21.39,14 20.92,13.17 20.12,12.95L14.81,11.53L12.05,2.5L10.12,2V10.28L5.15,8.95L4.22,6.63L2.77,6.24V11.41L4.37,11.84L9.68,13.27Z"/>'
    + '</svg>',

  // New Shepard 乘员舱 / 二级返回（源自 images/spacecraft_landing.svg）
  SPACECRAFT_LANDING:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">'
    + '<path fill-rule="evenodd" fill="${C}" d="M 480 468 Q 501 453 559 458 C 588 461 621 483 635 508 L 661 556 C 677 585 663 609 631 612 L 512 621 C 485 623 462 602 461 575 Q 459 483 480 468 Z M 388 450 L 421 464 L 362 611 L 329 598 L 388 450 Z M 362 321 L 601 324 Q 826 684 825 690 C 832 740 712 800 490 802 C 268 805 132 734 136 694 Q 129 680 362 321 Z M 328 430 L 361 443 L 297 602 L 264 588 L 328 430 Z"/>'
    + '<path fill="${C}" d="M 885 764 Q 798 828 623 850 L 630 904 Q 821 887 923 812 Q 1025 737 989 440 L 923 434 Q 971 699 885 764 Z"/>'
    + '<path fill="${C}" d="M 114 770 Q 200 835 375 857 L 368 911 Q 177 894 75 819 Q -27 744 9 447 L 75 440 Q 28 706 114 770 Z"/>'
    + '<rect x="368.294" y="115" width="52.151" height="174" fill="${C}"/>'
    + '<rect x="524.523" y="163" width="53.263" height="136" fill="${C}"/>'
    + '<rect x="450.107" y="0" width="53.339" height="232.5" fill="${C}"/>'
    + '</svg>',

  // 未能回收 / 失联（LOST）—— 告警三角
  LOST:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<path fill="${C}" d="M12 2L1 21H23M12 6L19.53 19H4.47M11 10V14H13V10M11 16V18H13V16"/>'
    + '</svg>'
}

/**
 * 把 landingType 映射到内部模板 key
 *   RECOVERY（伞降溅落）共用 SPLASHDOWN 图标，因为意义相近
 */
function pickTemplateKey(landingType) {
  if (!landingType) return null
  if (landingType === 'RECOVERY') return 'SPLASHDOWN'          // 伞降/翼伞回收 → 海面溅落图标
  if (landingType === 'VL') return 'RTLS'                      // 垂直动力着陆 → 复用陆地回收图标
  if (landingType === 'LANDSPACE') return 'LANDSPACE'          // 朱雀三号专用陆地图标
  if (landingType === 'BO_LZ') return 'BO_LZ'                  // 新格伦 LPV1 专用图标
  return TEMPLATES[landingType] ? landingType : null
}

/**
 * 根据 landing 类型 + 状态生成 dataURI
 * @param {string} landingType  - 'RTLS' | 'ASDS' | 'SPLASHDOWN' | 'RECOVERY' | 'EXPENDED'
 * @param {string} status       - 'success' | 'failure' | 'neutral'
 * @returns {string|null}       - data:image/svg+xml;... 字符串，或 null（无对应模板）
 */
function buildLandingIcon(landingType, status) {
  const key = pickTemplateKey(landingType)
  if (!key) return null
  const color = COLORS[status] || COLORS.neutral
  const svg = TEMPLATES[key].replace(/\$\{C\}/g, color)
  // encodeURI 不编码 '#'，但我们已经用 rgb() 避开 #，所以这里更简洁
  // 编码 # 和 % 防御性处理
  return 'data:image/svg+xml;utf8,' + encodeURI(svg).replace(/#/g, '%23').replace(/'/g, '%27')
}

/**
 * 根据 LL2 landing 字段 + landingType 推断成功/失败状态
 *   - EXPENDED（一次性使用/销毁）→ failure（橙色）—— 虽然是计划内不回收，
 *     但从"该助推器/飞船再也不能回收复用"的结果来看属于负面，
 *     详情页的"一次性使用 ATL"文字也是橙色呈现，首页图标颜色与之对齐
 *   - LOST                → failure
 *   - ld.success === true → success
 *   - ld.success === false→ failure
 *   - 其它（待确认）       → neutral
 */
function inferLandingStatus(ld, landingType) {
  if (landingType === 'EXPENDED') return 'failure'
  if (landingType === 'LOST') return 'failure'
  if (!ld) return 'neutral'
  if (ld.success === true) return 'success'
  if (ld.success === false) return 'failure'
  return 'neutral'
}

// LL2 abbrev/name → 内部统一类型（轻量版，仅 list 卡片图标用，与 api.js 内的 normalizeLandingType 行为一致）
function normalizeLandingTypeShort(raw) {
  if (!raw) return null
  const v = String(raw).toUpperCase().replace(/[\s_-]+/g, '')
  // LL2 config/landing_types 词表全集（ASDS/Ocean/HL/RTLS/EXP/ATM/VL/HC/PCL/PFL）+ 历史/推断类型全部覆盖，
  // 任何一种出现在 landing.type.abbrev/name 都能自动映射到图标与中文标签，无需再改代码
  if (v === 'EXP' || v === 'EXPENDED' || v === 'EXPENDABLE' || v === 'DISPOSED') return 'EXPENDED'
  if (v === 'ATM' || v.includes('DESTRUCTIVE')) return 'EXPENDED' // 再入烧毁 → 与一次性使用同待遇（橙色销毁图标）
  if (v === 'ASDS' || v === 'ASOG' || v === 'OCISLY' || v === 'JRTI' || v.includes('AUTONOMOUSSPACEPORT') || v.includes('DRONESHIP')) return 'ASDS'
  if (v === 'RTLS' || v.includes('RETURNTOLAUNCHSITE')) return 'RTLS'
  if (v === 'SD' || v.includes('SPLASHDOWN') || v === 'OCEAN') return 'SPLASHDOWN'
  if (v === 'PR' || v === 'PCL' || v === 'PFL' || v.includes('PARACHUTE') || v.includes('PARAFOIL') || v.includes('RECOVERY')) return 'RECOVERY'
  // 网系回收（拦阻网驳船）—— LL2 目前词表没有该类型，这里预留：将来新增 "Net"/"Arrestor Net" 类 abbrev/name 时自动识别
  if (v === 'NC' || v === 'NET' || v.includes('NETCATCH') || v.includes('ARRESTOR')) return 'NET_CATCH'
  // 直升机捕获必须先于塔架捕获判断，否则 "Helicopter Catch" 会被 CATCH 关键词误判
  if (v === 'HC' || v.includes('HELICOPTER')) return 'HELICOPTER_CATCH'
  if (v === 'TC' || v.includes('TOWER') || v.includes('CATCH') || v.includes('CHOPSTICK') || v.includes('MECHAZILLA')) return 'TOWER_CATCH'
  if (v === 'VL' || v.includes('VERTICALLANDING')) return 'VL'
  if (v === 'HL' || v.includes('HORIZONTALLANDING')) return 'HL'
  if (v.includes('LOST') || v.includes('FAILED')) return 'LOST'
  return v
}

/**
 * 通过 landing_location.abbrev / name 反推 landing 类型
 * —— 与 utils/api.js 的 inferLandingTypeFromLocation 完全对齐，
 * 确保"首页卡片图标"和"详情页卡片标签"在同一个推断结果下。
 *
 * 典型场景：Falcon Heavy 的中央芯 B1098 一次性使用打到 ATL（大西洋海域）
 * LL2 不填 landing.type，只给 landing_location.abbrev = "ATL"；
 * 详情页通过这里推出 EXPENDED 后显示"一次性使用 ATL"（橙色），
 * 首页卡片图标也要能走到 EXPENDED → 橙色的销毁图标。
 */
function inferLandingTypeFromLocationShort(abbrev, name) {
  const a = String(abbrev || '').toUpperCase().trim()
  const n = String(name || '').toUpperCase()
  const text = `${a} ${n}`
  if (/\bLZ[\s-]?\d+\b/.test(text)) return 'RTLS'
  // 星舰塔架捕获：LL2 常写成 RTLS + OLM-A（Orbital Launch Mount），无独立 Tower Catch 类型
  if (/\bOLM[\s-]?[A-Z0-9]*\b|ORBITAL\s*LAUNCH\s*MOUNT/.test(text)) return 'TOWER_CATCH'
  if (/\bLC[\s-]?\d+/.test(text) && /(MECHAZILLA|TOWER|CHOPSTICK|CATCH)/.test(text)) return 'TOWER_CATCH'
  if (/\bLZ\b|LANDING\s*ZONE/.test(text)) return 'RTLS'
  if (/OCISLY|JRTI|ASOG|\bASDS\b|OF\s*COURSE\s*I\s*STILL\s*LOVE\s*YOU|JUST\s*READ\s*THE\s*INSTRUCTIONS|SHORTFALL\s*OF\s*GRAVITAS/.test(text)) return 'ASDS'
  // 蓝色起源新格伦海上回收驳船 LPV1 / Jacklyn
  if (/\bLPV[\s-]?1\b|JACKLYN|LANDING\s*PLATFORM\s*VESSEL/.test(text)) return 'ASDS'
  if (/MECHAZILLA|TOWER\s*CATCH|CHOPSTICK/.test(text)) return 'TOWER_CATCH'
  // 网系回收驳船：将来 LL2 给出含 net/arrestor 的落点名时自动识别
  if (/ARRESTOR|NET\s*CATCH|RECOVERY\s*NET/.test(text)) return 'NET_CATCH'
  // 水平跑道着陆：罗布泊空军实验基地（CSSHQ 空天飞机等）
  if (/\bLNA\b|LOP\s*NUR/.test(text)) return 'HL'
  // ATL / PAC / 各大洋：常见于"打到海里销毁"，详情页统一归为 SPLASHDOWN / EXPENDED
  // 这里保守返回 SPLASHDOWN，由上游逻辑结合"是否一次性使用 + success 字段"决定最终颜色。
  // 但如果 launcher_stage.reused === false 且无 landing 成功记录 → 上游会覆盖为 EXPENDED。
  if (/\bATL\b|\bPAC\b|ATLANTIC|PACIFIC|INDIAN\s*OCEAN|\bOCEAN\b|SPLASHDOWN|\bGOM\b|GULF\s*OF\s*MEXICO|\bIND\b/.test(text)) return 'SPLASHDOWN'
  return null
}

/**
 * LL2 星舰塔架捕获常标成 RTLS + OLM-A，描述写 "caught by the launch pad tower"。
 * 在已有类型基础上用落点/描述二次纠正，避免误显示为陆地回收。
 * Super Heavy / Ship 共用同一套识别与 SPX_catch_tower 图标。
 */
const TOWER_CATCH_CONTEXT_REGEX = /\bOLM[\s-]?[A-Z0-9]*\b|ORBITAL\s*LAUNCH\s*MOUNT|MECHAZILLA|CHOPSTICK|TOWER\s*CATCH|(?:CAUGHT|CATCH).{0,48}TOWER|TOWER.{0,24}(?:CATCH|CAUGHT)/i
const TOWER_CATCH_SKIP_TYPES = {
  ASDS: 1,
  EXPENDED: 1,
  NET_CATCH: 1,
  HELICOPTER_CATCH: 1,
  DRAGON: 1,
  LOST: 1,
  HL: 1,
  SPLASHDOWN: 1,
  RECOVERY: 1
}

function refineLandingTypeWithContext(landingType, ld, locAbbrev, locName) {
  if (landingType === 'TOWER_CATCH') return 'TOWER_CATCH'
  if (landingType && TOWER_CATCH_SKIP_TYPES[landingType]) return landingType
  const desc = (ld && ld.description) || ''
  const text = `${locAbbrev || ''} ${locName || ''} ${desc}`
  if (TOWER_CATCH_CONTEXT_REGEX.test(text)) return 'TOWER_CATCH'
  return landingType
}

/**
 * LL2 助推器着陆用 landing_location，飞船着陆常用 location —— 统一读取
 */
function getLandingLocationObj(ld) {
  if (!ld || typeof ld !== 'object') return null
  return ld.landing_location || ld.location || null
}

/**
 * 落点展示：(LNA) 罗布泊空军实验基地
 */
function formatLandingPlaceLabel(abbrev, name) {
  const a = abbrev ? String(abbrev).trim() : ''
  const n = name ? String(name).trim() : ''
  let zh = ''
  try {
    const { translateLocation } = require('./space-terms-i18n.js')
    zh = translateLocation(n) || translateLocation(a) || ''
  } catch (_) {}
  const displayName = zh || n || a
  if (a && displayName && displayName.toUpperCase() !== a.toUpperCase()) {
    return `(${a}) ${displayName}`
  }
  return displayName || a || ''
}

/**
 * 网系回收识别（构型级兜底）
 * LL2 词表目前没有 Net/Arrestor 着陆类型：
 *   - 有结构化 stage 数据时走 normalizeLandingTypeShort / inferLandingTypeFromLocationShort（已预留 NET_CATCH 映射，LL2 更新后自动生效）
 *   - 无 stage 数据时按「构型 reusable === true + 描述/型号」识别（长征十号甲/乙的拦阻网驳船回收）
 */
const NET_RECOVERY_DESC_REGEX = /arrestor\s*net|recovery\s*net|net\s*catch|拦阻网|网系回收/i
const NET_RECOVERY_ROCKET_REGEX = /long\s*march\s*10\s*[ab]?\b|cz[-\s]*10[ab]?\b|长征十号|长十[甲乙]/i

// 朱雀三号 / 新格伦 / 新谢泼德识别（图标本体已内联为 TEMPLATES 里的 dataURI）
const ZHUQUE3_ROCKET_REGEX = /zhuque\s*[- ]?3\b|zq[- ]?3\b|朱雀\s*[三3]\s*号?/i
const LANDSPACE_AGENCY_REGEX = /land\s*space|蓝箭/i
const NEW_GLENN_ROCKET_REGEX = /new\s*glenn|新格伦/i
const BLUE_ORIGIN_AGENCY_REGEX = /blue\s*origin|蓝色起源|蓝源/i
const LPV1_CONTEXT_REGEX = /\bLPV[\s-]?1\b|JACKLYN|LANDING\s*PLATFORM\s*VESSEL/i
const NEW_SHEPARD_ROCKET_REGEX = /new\s*shepard|新谢泼德|新谢泼得/i

function resolveRocketConfig(launch) {
  return (launch && launch.rocket && launch.rocket.configuration)
    || (launch && launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
    || null
}

function inferNetRecoveryFromLaunch(launch) {
  const cfg = resolveRocketConfig(launch)
  if (!cfg || cfg.reusable !== true) return false
  if (NET_RECOVERY_DESC_REGEX.test(String(cfg.description || ''))) return true
  const name = [cfg.full_name, cfg.name, cfg.alias].filter(Boolean).join(' ')
  return NET_RECOVERY_ROCKET_REGEX.test(name)
}

/**
 * 蓝箭航天朱雀三号（ZQ-3）：陆地回收用专用 landspace.svg，不用通用 RTLS 图标。
 */
function isZhuque3Rocket(launch) {
  if (!launch) return false
  const cfg = resolveRocketConfig(launch)
  const lsp = launch.launch_service_provider || launch.lsp || null
  const rocketText = [cfg && cfg.full_name, cfg && cfg.name, cfg && cfg.alias, launch.name, launch.mission && launch.mission.name]
    .filter(Boolean).join(' ')
  if (ZHUQUE3_ROCKET_REGEX.test(rocketText)) return true
  // 机构名含朱雀/ZQ 且发射商为蓝箭 / LandSpace
  const agencyText = [lsp && lsp.name, lsp && lsp.abbrev].filter(Boolean).join(' ')
  if (LANDSPACE_AGENCY_REGEX.test(agencyText) && /zhuque|zq|朱雀/i.test(rocketText)) return true
  return false
}

/**
 * 蓝色起源新格伦（New Glenn）
 */
function isNewGlennRocket(launch) {
  if (!launch) return false
  const cfg = resolveRocketConfig(launch)
  const lsp = launch.launch_service_provider || launch.lsp || null
  const rocketText = [cfg && cfg.full_name, cfg && cfg.name, cfg && cfg.alias, launch.name, launch.mission && launch.mission.name]
    .filter(Boolean).join(' ')
  if (NEW_GLENN_ROCKET_REGEX.test(rocketText)) return true
  const agencyText = [lsp && lsp.name, lsp && lsp.abbrev].filter(Boolean).join(' ')
  if (BLUE_ORIGIN_AGENCY_REGEX.test(agencyText) && /glenn|格伦/i.test(rocketText)) return true
  return false
}

/**
 * 蓝色起源新谢泼德（New Shepard）
 */
function isNewShepardRocket(launch) {
  if (!launch) return false
  const cfg = resolveRocketConfig(launch)
  const lsp = launch.launch_service_provider || launch.lsp || null
  const rocketText = [cfg && cfg.full_name, cfg && cfg.name, cfg && cfg.alias, launch.name, launch.mission && launch.mission.name]
    .filter(Boolean).join(' ')
  if (NEW_SHEPARD_ROCKET_REGEX.test(rocketText)) return true
  const agencyText = [lsp && lsp.name, lsp && lsp.abbrev].filter(Boolean).join(' ')
  if (BLUE_ORIGIN_AGENCY_REGEX.test(agencyText) && /shepard|谢泼德|谢泼得/i.test(rocketText)) return true
  return false
}

/** 落点/描述是否指向 LPV1（Jacklyn） */
function isLpv1Landing(ld, locAbbrev, locName) {
  const desc = (ld && ld.description) || ''
  const text = `${locAbbrev || ''} ${locName || ''} ${desc}`
  return LPV1_CONTEXT_REGEX.test(text)
}

function isLandRecoveryType(landingType) {
  return landingType === 'RTLS' || landingType === 'VL' || landingType === 'LANDSPACE'
}

/**
 * 倒计时 / 任务卡片 / 详情共用图标解析。
 * - 朱雀三号陆地 → landspace dataURI
 * - 新格伦 LPV1/Jacklyn → BO_LZ.svg
 * - New Shepard 乘员舱/二级 → spacecraft_landing.svg
 */
function resolveLandingIconSrc(landingType, status, launch, opts) {
  opts = opts || {}
  if (isLandRecoveryType(landingType) && isZhuque3Rocket(launch)) {
    return buildLandingIcon('LANDSPACE', status || 'neutral')
  }
  if (isNewGlennRocket(launch) && isLpv1Landing(opts.ld, opts.locAbbrev, opts.locName)) {
    return buildLandingIcon('BO_LZ', status || 'neutral')
  }
  // New Shepard 二级/乘员舱返回：统一 spacecraft_landing 图标（助推器一级仍走 RTLS）
  if (opts.forSpacecraft && isNewShepardRocket(launch)) {
    return buildLandingIcon('SPACECRAFT_LANDING', status || 'neutral')
  }
  if (landingType === 'SPACECRAFT_LANDING') {
    return buildLandingIcon('SPACECRAFT_LANDING', status || 'neutral')
  }
  return buildLandingIcon(landingType, status)
}

function isLandspaceIconSrc(src) {
  if (typeof src !== 'string' || !src) return false
  if (src.indexOf('/images/landspace.svg') !== -1) return true
  return src.indexOf('M-0') !== -1 && src.indexOf('0.17') !== -1 && src.indexOf('viewBox=%220%200%200.17') !== -1
}

function isBoLzIconSrc(src) {
  if (typeof src !== 'string' || !src) return false
  if (src.indexOf('/images/BO_LZ.svg') !== -1) return true
  // 新旧模板：旧 viewBox 48.72 / 新几何版驳船路径特征（兼容 encodeURI）
  return (
    src.indexOf('viewBox=%220%200%2048.72') !== -1 ||
    src.indexOf('viewBox="0 0 48.72') !== -1 ||
    src.indexOf('h64v9H18') !== -1
  )
}

/**
 * 从一个 LL2 launch 对象提取所有"可回收对象"的图标列表，用于首页/历史发射任务卡片
 *
 * 规则：
 *   1) 每个 launcher_stage 元素 = 一个图标（Falcon Heavy 出 3 个，Falcon 9 出 1 个）
 *   2) 每个 spacecraft_stage 元素中如果是 Dragon 系列 = 龙飞船图标；
 *      Starship/Ship = 海面溅落图标（星舰飞船目前都是溅落）；
 *      其它按 landing.type 走通用规则
 *   3) missionType === 'upcoming' 时所有 status 强制为 neutral（白色），因为还没结果
 *   4) missionType === 'completed' 按 landing.success 推断 success/failure
 *
 * 返回数组：[{ icon: dataURI, status: 'success'|'failure'|'neutral', type: 'RTLS'|'ASDS'|... }]
 */
function extractRecoveryIcons(launch, missionType) {
  const icons = []
  if (!launch || !launch.rocket) return icons
  const isUpcoming = missionType !== 'completed'

  // 火箭名（用于判断"未填 landing 数据但本来就是可回收设计"的兜底情况）
  const rocketCfg = launch.rocket.configuration || {}
  const rocketName = String(rocketCfg.full_name || rocketCfg.name || '').toLowerCase()
  // 可回收火箭家族（含中国 / SpaceX / Blue Origin / Rocket Lab 等）
  const isReusableRocket = /falcon|starship|super\s*heavy|new\s*glenn|new\s*shepard|electron|neutron|长征八号|cz-?8|长征 8|长征九号|cz-?9|长征 9|terran/.test(rocketName)

  // ── 1) launcher_stage：所有助推器
  const lsRaw = launch.rocket.launcher_stage
    || (launch.rocket.rocket && launch.rocket.rocket.launcher_stage)
    || launch.rocket.first_stage
  const launcherStages = Array.isArray(lsRaw) ? lsRaw : (lsRaw ? [lsRaw] : [])
  launcherStages.forEach((stage) => {
    if (!stage) return
    const ld = stage.landing || (stage.launcher && stage.launcher.landing) || null
    const tObj = (ld && ld.type && typeof ld.type === 'object') ? ld.type : null
    // 推断链与详情页 buildBoosterStages 完全一致，纯 API 驱动：
    //   1) ld.type.abbrev / name      —— LL2 标准字段（"EXP"/"RTLS"/"ASDS"/"SD"...）
    //   2) 落点 abbrev/name 反推       —— ATL 海域 / LZ-1 / OCISLY 等
    //   3) reused===false + SPLASHDOWN + 无成功记录 → EXPENDED（与详情页 Falcon Heavy 中央芯处理一致）
    //
    // 如果以上三步都推不出来 → 直接跳过，不画图标。
    // 这样首页和详情页保持一致：LL2 没给数据时两边都留空，等 API 补数据后同步显示。
    // 之前的 UNKNOWN 问号 / ASDS 兜底 都会误导用户"有数据"，已去除。
    let ltype = normalizeLandingTypeShort(
      (tObj && (tObj.abbrev || tObj.name)) || (ld && typeof ld.type === 'string' ? ld.type : null)
    )
    if (!ltype) {
      const lloc = getLandingLocationObj(ld)
      const labbrev = (lloc && lloc.abbrev) || null
      const lname = (lloc && lloc.name) || null
      ltype = inferLandingTypeFromLocationShort(labbrev, lname)
    }
    // 星舰：RTLS + OLM-A / "caught by ... tower" → 塔架捕获（与详情页 refine 同源）
    {
      const lloc = getLandingLocationObj(ld)
      ltype = refineLandingTypeWithContext(ltype, ld, lloc && lloc.abbrev, lloc && lloc.name)
    }
    // Falcon Heavy 中央芯 B1098 打到高轨道后销毁：LL2 没给 landing.type，只给 landing_location: ATL
    // 但 reused === false（首飞即末飞），且 landing.success 没有 true —— 说明是"一次性使用"而非"等打捞"
    const reusedFlag = stage.reused === true
    const landedOk = !!(ld && ld.success === true)
    if (ltype === 'SPLASHDOWN' && !reusedFlag && !landedOk) {
      ltype = 'EXPENDED'
    }
    if (!ltype) return // LL2 未提供数据 → 不画图标，与详情页表现一致
    const status = isUpcoming ? 'neutral' : inferLandingStatus(ld, ltype)
    const lloc = getLandingLocationObj(ld)
    const useLandspace = isLandRecoveryType(ltype) && isZhuque3Rocket(launch)
    const useBoLz = isNewGlennRocket(launch) && isLpv1Landing(ld, lloc && lloc.abbrev, lloc && lloc.name)
    const icon = resolveLandingIconSrc(ltype, status, launch, {
      ld,
      locAbbrev: lloc && lloc.abbrev,
      locName: lloc && lloc.name
    })
    if (icon) {
      icons.push({
        icon,
        status,
        type: ltype,
        variant: useLandspace ? 'landspace' : (useBoLz ? 'bolz' : '')
      })
    }
  })

  // ── 1.5) 构型级兜底：网系回收火箭（长十乙等）LL2 未建 stage 记录时也画图标
  // 一旦 LL2 补上带 landing.type/success 的 stage 数据，上面的结构化链路会先出图标（含绿/橙结果色），这里自动让位
  if (icons.length === 0 && inferNetRecoveryFromLaunch(launch)) {
    const status = 'neutral' // 无结构化着陆结果数据，统一中性色；结果色交给结构化链路
    const icon = buildLandingIcon('NET_CATCH', status)
    if (icon) icons.push({ icon, status, type: 'NET_CATCH' })
  }

  // ── 2) spacecraft_stage：龙飞船 / 星舰飞船等可回收飞船
  const ssRaw = launch.rocket.spacecraft_stage
    || (launch.rocket.rocket && launch.rocket.rocket.spacecraft_stage)
    || (launch.rocket.configuration && launch.rocket.configuration.spacecraft_stage)
  const spacecraftStages = Array.isArray(ssRaw) ? ssRaw : (ssRaw ? [ssRaw] : [])
  spacecraftStages.forEach((stage) => {
    if (!stage) return
    const sc = (stage.spacecraft && typeof stage.spacecraft === 'object') ? stage.spacecraft : stage
    const scCfg = (sc && typeof sc.configuration === 'object')
      ? sc.configuration
      : (sc && typeof sc.spacecraft_config === 'object' ? sc.spacecraft_config : null)
    const ld = stage.landing || (sc && sc.landing) || null
    // 与详情页 shipStages 对齐的推断链：
    //   1) ld.type.abbrev / name           —— LL2 标准 landing 字段
    //   2) 落点 abbrev/name 反推            —— ATL/PAC 反推 SPLASHDOWN 等
    //   3) spacecraft_config 家族识别      —— Dragon 系列走 DRAGON 图标（LL2 字段，非启发式猜测）
    // 推不出来就不画图标（与详情页表现一致）
    const tObj = (ld && ld.type && typeof ld.type === 'object') ? ld.type : null
    let iconType = normalizeLandingTypeShort(
      (tObj && (tObj.abbrev || tObj.name)) || (ld && typeof ld.type === 'string' ? ld.type : null)
    )
    if (!iconType) {
      const lloc = getLandingLocationObj(ld)
      iconType = inferLandingTypeFromLocationShort(lloc && lloc.abbrev, lloc && lloc.name)
    }
    // Dragon 系列（Cargo Dragon 2 / Crew Dragon）—— LL2 通常不填 landing.type，
    // 只填 landing_location="Atlantic"/"Pacific"，前面两步只会得到 SPLASHDOWN。
    // 这里按 spacecraft_config.name 覆盖成 DRAGON，与详情页 shipStages 保持一致。
    const shipFamilyName = String(
      (scCfg && (scCfg.full_name || scCfg.name)) || sc.name || ''
    ).toLowerCase()
    const scTypeName = String(
      (scCfg && scCfg.type && (scCfg.type.name || scCfg.type)) || ''
    ).toLowerCase()
    // 空天飞机：图标统一 HL，仅落点名称随任务变化
    const isSpaceplane = /spaceplane/.test(scTypeName)
      || /reusable\s*space\s*vehicle|可重复使用试验航天器|csshq/i.test(shipFamilyName)
    if (/dragon/.test(shipFamilyName)) {
      iconType = 'DRAGON'
    } else if (isSpaceplane) {
      iconType = 'HL'
    } else if (isNewShepardRocket(launch)) {
      // New Shepard 乘员舱 / 二级返回：统一 spacecraft_landing 图标
      iconType = 'SPACECRAFT_LANDING'
    } else {
      // Ship / Super Heavy 飞船级：OLM 塔架捕获或 Ocean 溅落二次纠正
      const lloc = getLandingLocationObj(ld)
      iconType = refineLandingTypeWithContext(iconType, ld, lloc && lloc.abbrev, lloc && lloc.name)
    }
    if (!iconType) return
    const status = isUpcoming ? 'neutral' : inferLandingStatus(ld, iconType)
    const useLandspace = isLandRecoveryType(iconType) && isZhuque3Rocket(launch)
    const icon = resolveLandingIconSrc(iconType, status, launch, {
      ld,
      locAbbrev: (getLandingLocationObj(ld) || {}).abbrev,
      locName: (getLandingLocationObj(ld) || {}).name,
      forSpacecraft: true
    })
    if (icon) {
      icons.push({
        icon,
        status,
        type: iconType,
        variant: useLandspace ? 'landspace' : ''
      })
    }
  })

  return icons
}

module.exports = {
  buildLandingIcon,
  inferLandingStatus,
  normalizeLandingTypeShort,
  inferLandingTypeFromLocationShort,
  refineLandingTypeWithContext,
  getLandingLocationObj,
  formatLandingPlaceLabel,
  extractRecoveryIcons,
  inferNetRecoveryFromLaunch,
  isZhuque3Rocket,
  isNewGlennRocket,
  isNewShepardRocket,
  isLpv1Landing,
  isLandRecoveryType,
  resolveLandingIconSrc,
  isLandspaceIconSrc,
  isBoLzIconSrc
}
