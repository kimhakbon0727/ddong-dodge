# 똥 피하기

하늘에서 떨어지는 똥을 피하는 브라우저 게임입니다. PC(키보드)와 스마트폰(터치) 모두 됩니다.
Node.js 서버 하나로 돌아가고, **외부 패키지 설치가 필요 없습니다** (`npm install` 불필요).
점수는 서버에 저장되는 **랭킹(TOP 10)** 으로 친구들과 겨룰 수 있어요.

기본 포트는 **3003** 입니다. (할리갈리 서버는 3000이라 둘을 동시에 켜도 부딪치지 않아요.)

---

## 1. 실행

Node.js 18 이상이 필요합니다 (`node -v` 로 확인).

```bash
cd ~/app/ddong
node server.js
```

```
💩 똥 피하기 서버 실행 중 (포트 3003)
   이 컴퓨터에서:  http://localhost:3003
   랭킹 파일:      /home/userk/app/ddong/data/scores.json
```

- 이 PC 브라우저에서 `http://localhost:3003` 을 열면 됩니다.
- 끄려면 서버를 켠 창에서 `Ctrl+C`.
- 포트를 바꾸려면 `PORT=3004 node server.js`.
- 서버 화면에 나오는 `(WSL 내부 주소)` 는 WSL 안에서만 쓰는 주소라서, 친구에게는 알려주지 마세요.

## 2. 게임 방법

| 조작 | 방법 |
| --- | --- |
| PC | `←` `→` 또는 `A` `D` 로 이동, `Space`/`Enter` 로 시작·다시 하기 |
| 스마트폰 | 화면을 누른 채 좌우로 끌기 (누른 곳으로 캐릭터가 따라가요) |

- 똥에 한 번 맞으면 끝입니다.
- 땅에 떨어진 똥을 **피한 개수**가 점수예요. 시간이 지날수록 똥이 더 많이, 더 빠르게 떨어집니다.
- 게임이 끝나면 이름을 적어 랭킹에 등록할 수 있어요 (1개 이상 피했을 때).
- 내 최고 기록은 브라우저에 저장됩니다. 랭킹은 서버에 저장돼서 모두가 같이 봅니다.

## 3. 친구들이 접속하게 하기 (WSL)

WSL은 Windows 안의 가상 네트워크에 있어서, 다른 컴퓨터가 들어오려면 **세 군데**를 열어야 합니다.
(할리갈리 때 3000번을 연 것과 똑같은 방법이고, 번호만 3003입니다.)

### 3-1. Windows에서 길 열기 (관리자 PowerShell, 명령은 한 줄씩 따로)

WSL 내부 IP를 변수에 담고, 3003번을 WSL로 넘기는 규칙을 만듭니다.

```powershell
$ip = ((wsl hostname -I) -split ' ')[0].Trim()
```
```powershell
netsh interface portproxy add v4tov4 listenport=3003 listenaddress=0.0.0.0 connectport=3003 connectaddress=$ip
```
방화벽도 엽니다.
```powershell
New-NetFirewallRule -DisplayName "Ddong 3003" -Direction Inbound -Protocol TCP -LocalPort 3003 -Action Allow
```
확인:
```powershell
netsh interface portproxy show all
```
`0.0.0.0  3003  (WSL 주소)  3003` 줄이 보이면 성공입니다.

> 명령을 **한 줄씩 따로** 실행하세요. 여러 줄을 한꺼번에 붙여넣으면 줄이 합쳐져 에러가 납니다.
> `v4tov4` 는 `v4` + `to` + `v4` 입니다 (오타 주의).

### 3-2. 같은 와이파이에서 시험

PowerShell에서 `ipconfig` 로 Wi-Fi의 IPv4 주소를 확인하고, 같은 와이파이의 스마트폰에서 `http://그주소:3003` 을 열어 봅니다.

### 3-3. 인터넷 너머 친구용 (공유기)

공유기 관리 화면 → 방화벽 → 포트 포워딩에 추가합니다.

| 칸 | 값 |
| --- | --- |
| 서비스(외부) 포트 | 3003 |
| 프로토콜 | TCP |
| 내부 주소 | 이 PC의 Wi-Fi IPv4 주소 |
| 내부 포트 | 3003 |

목록에 이미 3003번이 있는지 먼저 확인하세요. 그다음 WSL에서 `curl ifconfig.me` 로 공인 IP를 확인하고, 친구들에게 `http://공인IP:3003` 을 알려주면 됩니다.
(집 안에서 공인 IP로 접속하면 안 열릴 수 있어요. 확인은 모바일 데이터로 하세요.)

### 3-4. 재부팅한 뒤 접속이 안 될 때

WSL 내부 IP가 바뀌면 `portproxy` 규칙이 옛 주소를 가리켜서 끊깁니다. 관리자 PowerShell에서 다시 만드세요.

```powershell
$ip = ((wsl hostname -I) -split ' ')[0].Trim()
netsh interface portproxy delete v4tov4 listenport=3003 listenaddress=0.0.0.0
netsh interface portproxy add v4tov4 listenport=3003 listenaddress=0.0.0.0 connectport=3003 connectaddress=$ip
```
(같은 이유로 다른 포트 규칙도 같이 안 될 수 있어요. 같은 방식으로 `$ip` 로 다시 만듭니다.)

### 3-5. 안 쓸 때 닫기

서버를 끄면 가장 간단합니다. 규칙까지 지우려면:
```powershell
netsh interface portproxy delete v4tov4 listenport=3003 listenaddress=0.0.0.0
Remove-NetFirewallRule -DisplayName "Ddong 3003"
```
공유기에서는 3003번 줄만 삭제하세요.

## 4. 계속 켜두기 (선택)

```bash
sudo apt install -y tmux          # 처음 한 번
tmux new -s ddong
cd ~/app/ddong && node server.js
# 빠져나오기: Ctrl+B 누르고 → D  (서버는 계속 실행)
tmux attach -t ddong              # 다시 들어가기
```
PC를 재부팅하면 서버도 꺼지므로 다시 켜야 합니다.

## 5. 랭킹 파일

- 랭킹은 `data/scores.json` 에 저장되고, 서버를 껐다 켜도 유지됩니다.
- 기록을 전부 지우고 싶으면 서버를 끈 뒤 `rm data/scores.json`.
- 최대 100개까지 보관하고 화면에는 10개를 보여줍니다.
- 이 파일은 `.gitignore` 에 들어 있어서 깃에 올라가지 않습니다.

## 6. 난이도 바꾸기

`public/game.js` 맨 위의 숫자만 고치면 됩니다.

| 이름 | 뜻 | 기본값 |
| --- | --- | --- |
| `PLAYER_SPEED` | 캐릭터 이동 속도 | 330 |
| `SPAWN_START` | 처음 똥이 나오는 간격(초) | 0.85 |
| `SPAWN_MIN` | 가장 빠를 때의 간격(초) | 0.22 |
| `SPAWN_SPEEDUP` | 1초마다 간격이 줄어드는 양 | 0.012 |
| `FALL_START` | 똥이 처음 떨어지는 속도 | 150 |
| `FALL_MAX_BONUS` | 시간이 지나며 더해지는 속도 최대치 | 300 |
| `AIMED_CHANCE` | 캐릭터 근처로 떨어지는 똥 비율 | 0.35 |

`SPAWN_MIN` 을 0.2 아래로 줄이면 서버가 "점수가 너무 높다"며 등록을 거절할 수 있어요
(서버는 초당 5개를 넘는 기록을 거절합니다. `server.js` 의 `MAX_DODGE_PER_SEC`).

## 7. 파일 구성

```
server.js        화면 제공 + 랭킹 API (GET/POST /api/scores)
public/          index.html, style.css, game.js (브라우저 게임)
test/test.js     서버·랭킹 API 테스트 (node test/test.js)
data/            랭킹 파일이 생기는 곳 (자동 생성)
```

## 8. 알아둘 점

- **로그인이 없습니다.** 주소를 아는 사람은 누구나 플레이하고 랭킹에 올릴 수 있어요. 안 할 때는 서버를 끄세요.
- 랭킹 점수는 브라우저가 보내는 값이라, 마음먹고 조작하면 가짜 점수를 올릴 수 있습니다. 서버가 "시간에 비해 너무 높은 점수", 도배, 이상한 이름은 막지만 완벽한 방어는 아니에요. 친구들끼리 노는 용도에 맞춘 수준입니다.
- 이름은 최대 10글자이고 `< > & " '` 같은 문자는 자동으로 지워집니다.
- 연결은 `http`(암호화 없음)입니다.
