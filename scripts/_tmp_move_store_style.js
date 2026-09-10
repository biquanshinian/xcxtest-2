const fs=require("fs");
const p="subpackages/shared/components/popup-ad/popup-ad.js";
let s=fs.readFileSync(p,"utf8");
s=s.replace("require('../../../../utils/store-product-style.js')","require('../../utils/store-product-style.js')");
fs.writeFileSync(p,s);
fs.unlinkSync("utils/store-product-style.js");
console.log("moved store-product-style");
