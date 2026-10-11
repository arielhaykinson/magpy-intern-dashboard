cd /workspace/magpy-dashboard; P=$PWD
S(){ google-chrome --headless=new --no-sandbox --user-data-dir=/tmp/chp$RANDOM --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=$2 --virtual-time-budget=3000 --screenshot=$P/shots/$1.png "http://localhost:8765/index.html$3" >/dev/null 2>&1; }
S tasks 1280,860 '#demo'; S calendar 1280,1100 '#demo&calendar'; S board 1280,700 '#demo&board'; S hours 1280,640 '#demo&hours'
S meetings 1280,1060 '#demo&meetings'
S tasks-menu 1280,860 '#demo&pmenu'
