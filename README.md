# MMM-Sonos

<p>
<a href="https://github.com/jishi/node-sonos-http-api"><img src="https://img.shields.io/badge/Sonos-API-orange.svg" alt="API"></a>
<a href="http://choosealicense.com/licenses/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

This is an adaption and modification of of [Vaggan's](https://github.com/Vaggan) [MagicMirror-SonosModule](https://github.com/Vaggan/MagicMirror-SonosModule) and [CFenner's](https://github.com/CFenner) [MagicMirror-SonosModule](https://github.com/CFenner/MagicMirror-Sonos-Module). It was modified to get some enhancements in visualisation an configuration. Also the module hides itself when not playing now.

Note from Snille: I'm new to the MagicMirror world and Node.js, this is my first attempt to modify a module. There are probably lot's of things that could have been done better. :)

When starting the Mirror:

![Sonos Module Loading](./.github/Sonos-Loading.png)

Module on the Right side of the Mirror:

![Sonos Module Right](./.github/Sonos-Right.png)



## Usage

_Prerequisites_

- requires MagicMirror² running on Node.js 18 or newer
- install and [run](https://github.com/MichMich/MagicMirror/wiki/Auto-Starting-MagicMirror) [node-sonos-http-api](https://github.com/jishi/node-sonos-http-api)

### Installation

In your terminal, go to your MagicMirror's Module folder:

```
cd ~/MagicMirror/modules
```

Clone this repository:

```
git clone https://github.com/Perhan35/MMM-Sonos.git
```

No `npm install` is needed: the module has no dependencies.


Add some [config entries](#configuration) to your config.js file. After that the content will be added to your mirror.

### Configuration

To run the module properly, you need to add the following data to your config.js file.

```
{
	module: 'MMM-Sonos',
	header: "Playing on SONOS",
	position: "top_center", // This can be any of the regions, best results in center regions
	classes: "default everyone",
	config: {
		// See 'Configuration options' for more information.
	}
}
```

Here are the configuration options to configure the module.

| Option | Description |
|---|---| 
|`showAlbumArt`|Show the album art.<br><br>**Default value:** `true`|
|`showRoomName`|Show the zone name and volume.<br><br>**Default value:** `true`|
|`preRoomText`|Text to be displayed before the zone name.<br><br>**Default value:** `Zone: `|
|`preArtistText`|Text to be displayed before the artist name.<br><br>**Default value:** `Artist: `|
|`preTrackText`|Text to be displayed before the track name.<br><br>**Default value:** `Track: `|
|`preTypeText`|Text to be displayed before the source name.<br><br>**Default value:** `Source: `|
|`animationSpeed`|Length of the fade animation in ms (used when the song changes).<br><br>**Default value:** `1000`|
|`updateInterval`|Update interval in minutes. With the [webhook](#real-time-updates-webhook) set up, this is only a fallback (and refreshes the progress bar).<br><br>**Default value:** `0.5`|
|`apiBase`|http link to the SONOS API.<br><br>**Default value:** `http://localhost`|
|`apiPort`|SONOS API port.<br><br>**Default value:** `5005`|
|`apiEndpoint`|Link to the "zones" information on the SONOS API.<br><br>**Default value:** `zones`|
|`exclude`|Zone names to exclude, e.g. `["Secret-Room", "Greenhouse"]`.<br><br>**Default value:** `[]`|
|`speakerUrls`|Optional. Only needed if some album art is missing. The API usually gives the full album art address; when it only gives a path, the module uses this speaker address. Keys are room names (or speaker UUIDs), e.g. `{ "Living Room": "http://192.168.1.20:1400" }`.<br><br>**Default value:** `{}`|
|`apiAlbumArt`|Fallback address for album art paths when the room is not in `speakerUrls`.<br><br>**Default value:** `http://localhost`|
|`proxyAlbumArt`|The mirror fetches the album art and serves it to the browser. Needed when the screen showing the mirror cannot reach the speakers (other network/VLAN, no internet) or opens the mirror over https. Only images given by the Sonos API, or on a known speaker, are fetched. Set `false` to load images straight from the speakers.<br><br>**Default value:** `true`|

The module only shows zones that are playing, and hides itself when nothing plays.

### Real-time updates (webhook)

By default the module asks the Sonos API for updates every `updateInterval` (30 seconds), so track changes can show up late. To refresh instantly, let node-sonos-http-api notify the mirror on every Sonos event.

Add this to node-sonos-http-api's `settings.json`, then restart it:

```json
{
  "webhook": "http://localhost:8080/MMM-Sonos/webhook"
}
```

- `8080` is MagicMirror's default port: use yours if you changed it.
- If node-sonos-http-api runs on **another machine** than the mirror, replace `localhost` with the mirror's address and add the API machine's IP to `ipWhitelist` in MagicMirror's `config.js` (by default only localhost is allowed, other calls get a `403`).
- node-sonos-http-api supports **only one** webhook URL: if you already use it for something else (e.g. Home Assistant), this replaces it.

To check it works, run this on the mirror: the display should refresh right away.

```
curl -X POST http://localhost:8080/MMM-Sonos/webhook
```

### Custom-CSS

Here is my CSS settings for the module that I have added to my custom.css to give it the exta special look. :)

```
/* Sonos --------------------------------------------*/
.sonos ul .type {
    font-size: 12px;
	padding: 0px 0px;
	line-height: 12px;
	width: 260px;
}
.sonos ul .room {
    font-size: 16px;
	padding: 0px 0px;
	line-height: 16px;
	width: 260px;
}
.sonos ul .song {
	padding: 0px 0px;
	position: relative;
}
.sonos ul .art img {
    height: 60px;
    width: 60px;
	border-radius: 50%;
	margin: 0px 0px;
	border: 2px solid #FFF;
}
.sonos ul .name {
    width: 200px;
    font-size: 16px;
	padding: 0px 4px;
	line-height: 16px;
}
/*****************************************************/
```
