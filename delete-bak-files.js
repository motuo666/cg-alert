const fs = require('fs');
const path = require('path');

const directoryPath = path.join(__dirname, 'vendors');

function deleteBakFiles(dirPath) {
  fs.readdirSync(dirPath).forEach(function (vendorDir) {
    const vendorPath = path.join(dirPath, vendorDir);
    
    // 确保是目录
    if (fs.statSync(vendorPath).isDirectory()) {
      const bakFile = path.join(vendorPath, 'index.html.bak');
      
      // 删除文件
      if (fs.existsSync(bakFile)) {
        fs.unlinkSync(bakFile);
        console.log(`Deleted: ${bakFile}`);
      }
    }
  });
}

deleteBakFiles(directoryPath);
