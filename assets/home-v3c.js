
// Copy Escalation Language (robust)
(function(){
  try{
    var btn = document.getElementById('copy');
    var note = document.getElementById('copied');
    if(btn){
      btn.addEventListener('click', function(){
        var pre = document.querySelector('.cg-evi-card pre.cg-raw');
        var text = pre ? pre.textContent.trim() : '';
        if(!text){ text = 'No escalation text available.'; }
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
          .then(function(){
            if(note){ note.textContent = 'Copied!'; setTimeout(function(){ note.textContent=''; }, 2000); }
          })
          .catch(function(){
            try{
              var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
              document.execCommand('copy'); document.body.removeChild(ta);
              if(note){ note.textContent = 'Copied!'; setTimeout(function(){ note.textContent=''; }, 2000); }
            }catch(e){ if(note){ note.textContent='Copy failed'; } }
          });
      });
    }
  }catch(e){}
})();