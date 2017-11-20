
//https://github.com/google/closure-compiler

let app;
let animations;
let player;
let allowGameLoop = true;

$(document).ready(() => {
	app = new PIXI.Application();
	$("#game-container").append(app.view);
	app.renderer.backgroundColor = 0x222222;
	app.renderer.resize(600, 600);
})

const REMOVE_EVENT = -1;
const MOVEMENT_SPEED = 4;
const PLAYER_COOLDOWN_READY = 5;
const PLAYER_HITBOX = 4;

//http://scottmcdonnell.github.io/pixi-examples/index.html?s=demos&f=texture-rotate.js&title=Texture%20Rotate
const ROTATE_FLIP_VERTICAL = 12;
const ROTATE_FLIP_HORIZONTAL = 8;

//0, 45, 90, ..., 315
const rotations = [
	0, 7, 6, 5, 4, 3, 2, 1
];
function rotation(rotation) {
	return rotations[Math.floor(rotation / 45)];
}

class Animations {
	constructor() {
		Animations.self = this;
		this.loading = [];
	}

	load(name, nframes, loop, custom) {
		this.loading.push({
			"name": name,
			"nframes": nframes,
			"loop": loop,
			"custom": custom != null ? custom : (_) => {}
		});
		PIXI.loader.add("./res/frames/" + name + ".json", {crossOrigin: ''});
	}

	/**
	 * Delegate to load() for all prefix$k, k being a multiple of 45 in [0,360)
	 */
	loadAllRotations(prefix, nframes, loop, custom) {
		if (custom == null) {
			custom = (_) => {};
		}
		for (var k = 0; k < 360; k += 45) {
			let rotate = rotation(k);
			this.load(prefix + k, nframes, loop, (frame) => {
				custom(frame);
				frame.rotate = rotate;
			});
		}
	}

	execute() {
		PIXI.loader.load((loader, resources) => {
			let current;
			for (var k = 0; k < this.loading.length; k++) {
				current = this.loading[k];
				this[current.name] = {
					"frames": []
				};
				let frame;
				for (var h = 0; h < current.nframes; h++) {
					frame = PIXI.Texture.fromFrame(current.name + h);
					current.custom(frame);
					this[current.name].frames.push(frame);
				}
				this[current.name].loop = current.loop;
			}
		});
	}
}

animations = new Animations();
animations.load("playerIdle", 4, true, null);
animations.load("playerIdleLeft", 7, false, null);
animations.load("playerIdleRight", 7, false, (frame) => {
	frame.rotate = ROTATE_FLIP_VERTICAL;
});

animations.load("cirno", 4, true, null);
animations.load("fairyBlue", 8, true, null);
animations.load("fairyRed", 8, true, null);
animations.load("fairyGreen", 8, true, null);

animations.loadAllRotations("projectileKnifeIdle", 1, false, null);
animations.load("projectileFocusIdle", 1, false, null);
animations.loadAllRotations("projectileIce", 1, false, null);

animations.load("orbBlack", 1, false, null);
animations.load("orbBlue", 1, false, null);
animations.load("orbGreen", 1, false, null);
animations.load("orbGrey", 1, false, null);
animations.load("orbLightBlue", 1, false, null);
animations.load("orbLightGreen", 1, false, null);
animations.load("orbLightPurple", 1, false, null);
animations.load("orbLightRed", 1, false, null);
animations.load("orbLightYellow", 1, false, null);
animations.load("orbMagenta", 1, false, null);
animations.load("orbOrange", 1, false, null);
animations.load("orbPink", 1, false, null);
animations.load("orbPurple", 1, false, null);
animations.load("orbRed", 1, false, null);
animations.load("orbYellow", 1, false, null);
animations.load("orbYellowGreen", 1, false, null);

function getTimeNow() {
	return Date.now();
}

class List {
	constructor(capacity) {
		if (typeof(capacity) === "undefined") {
			capacity = 0;
		}
		this.length = 0;
		this.capacity = capacity;
		this.self = new Array(capacity);
		for (var k = 0; k < capacity; ++k) {
			this.self[k] = null;
		}
	}

	get(index) {
		return this.self[index];
	}

	set(index, value) {
		this.self[index] = value;
	}

	push(value) {
		if (this.length === this.capacity) {
			this.self = this.self.concat(new Array(this.capacity));
		}
		this.self[this.length] = value;
		this.capacity *= 2;
		return this.length++;
	}

	pop(value) {
		if (this.length == 0) {
			return null;
		}
		let ret = this.self[--this.length];
		this.self[this.length] = null;
		return ret;
	}

	clear() {
		for (var k = 0, length = this.length; k < length; ++k) {
			this.self[k] = null;
		}
	}
}

class GarbageCollector extends List {
	constructor() {
		super();
		this.empty = new List();
	}

	track(item) {
		let index = this.empty.pop();
		if (index === null) {
			index = this.push(item);
		} else {
			this.set(index, item);
		}
		item._gc = index;
	}

	untrack(item) {
		let index = item._gc;
		this.set(index, null);
		this.empty.push(index);
	}

	clear() {
		super.clear();
		this.empty.clear();
	}
}

let TRUE_PREDICATE = (_) => { return true; };
let FALSE_PREDICATE = (_) => { return false; };

class Dispatcher extends GarbageCollector {
	constructor(capacity) {
		super(capacity);
		this.index = 0;
	}

	/**
	 * Dispatches `count` entities.
	 */
	dispatch(count) {
		for (var length = this.index + count; this.index < length; ++this.index) {
			this.get(this.index).dispatch();
		}
	}

	/**
	 * Adjusts the index by `count`.
	 */
	seek(count) {
		this.index += count;
	}

	/**
	 * Dispatches `count` entities with false dependencies,
	 * causing them to destroy themselves.
	 */
	ignore(count) {
		for (var length = this.index + count; this.index < length; ++this.index) {
			this.get(this.index).dependOn(FALSE_PREDICATE).dispatch();
		}
	}
}

let playerProjectiles = new Dispatcher();
let enemyProjectiles = new Dispatcher();
let enemies = new Dispatcher();

const EVENT_TIME = 0;
const EVENT_FN = 1;

class Entity {
	constructor(tracker, frames, x, y) {
		this.tracker = tracker;
		this.dependency = TRUE_PREDICATE;
		this.currentEvent = null;
		if (tracker !== null) { //if not master
			this.tracker.track(this);
			this.frames = frames;

			let anim = animations[frames];
			this.handle = new PIXI.extras.AnimatedSprite(anim.frames);
			this.handle.loop = anim.loop;
			this.handle.x = x;
			this.handle.y = y;
			this.handle.anchor.set(0.5);
			this.handle.animationSpeed = 0.5;
		}
		this.events = new GarbageCollector();
		this.destroyed = false;
		this.dispatched = false;
	}

	ensureAlive() {
		if (this.tracker !== null && this.handle.transform === null) {
			this.destroy();
			return false;
		}
		return true;
	}

	destroy() {
		this.destroyed = true;
		if (this.tracker != null) { //if not master
			this.tracker.untrack(this);
			app.stage.removeChild(this.handle);
			this.handle.destroy();
		}
	}

	onUpdate(_) {
		if (this.destroyed || !this.ensureAlive()) {
			return;
		}
		let delta = getTimeNow() - this.spawnTime;
		let e;
		for (var k = 0, length = this.events.length; k < length; ++k) {
			e = this.events.get(k);
			if (e !== null && e[EVENT_TIME] <= delta) {
				this.currentEvent = e;
				let newtime = e[EVENT_FN](this);
				if (newtime === REMOVE_EVENT) {
					this.events.untrack(e);
				} else {
					e[EVENT_TIME] = delta + newtime;
				}
			}
		}
	}

	mutateEvent(fn) {
		this.currentEvent[EVENT_FN] = fn;
		return this;
	}

	dispatch() {
		if (!this.dependency(this)) {
			//no checking for master as it can't fail the dependency test
			this.handle.destroy();
			return;
		}
		if (this.tracker != null) {
			this.handle.play();
			app.stage.addChild(this.handle);
		}
		this.spawnTime = getTimeNow();
	}

	addEvent(offset, fn) {
		this.events.track([offset, fn]);
		return this;
	}

	dependOn(dependency) {
		this.dependency = dependency;
		return this;
	}
}

class Master extends Entity {
	constructor() {
		super(null, null, 0, 0);
		this.fragmentTime = 0;
	}

	destroy() {
		PIXI.ticker.shared.remove(this.onUpdate, this);
		super.destroy();
		let e;
		for (var k = 0, length = enemyProjectiles.length; k < length; ++k) {
			e = enemyProjectiles.get(k);
			if (e !== null) {
				e.destroy();
			}
		}
		for (var k = 0, length = playerProjectiles.length; k < length; ++k) {
			e = playerProjectiles.get(k);
			if (e !== null) {
				e.destroy();
			}
		}
		for (var k = 0, length = enemies.length; k < length; ++k) {
			e = enemies.get(k);
			if (e !== null) {
				e.destroy();
			}
		}
		enemyProjectiles.clear();
		playerProjectiles.clear();
		enemies.clear();
	}

	dispatch() {
		super.dispatch();
		PIXI.ticker.shared.add(this.onUpdate, this);
	}

	addEvent(offset, fn) {
		super.addEvent(offset + this.fragmentTime, fn);
	}

	fragment(time) {
		this.fragmentTime += time;
		console.log("fragment at " + this.fragmentTime);
	}

	onUpdate(_) {
		super.onUpdate(_);
		if (this.destroyed) {
			return;
		}
		let e;
		for (var k = 0, length = enemies.length; k < length; ++k) {
			e = enemies.get(k);
			if (e !== null) {
				e.onUpdate(_);
			}
		}
		for (var k = 0, length = enemyProjectiles.length; k < length; ++k) {
			e = enemyProjectiles.get(k);
			if (e !== null) {
				e.onUpdate(_);
			}
		}
		for (var k = 0, length = playerProjectiles.length; k < length; ++k) {
			e = playerProjectiles.get(k);
			if (e !== null) {
				e.onUpdate(_);
			}
		}
	}
}

let master = new Master();

//enemies should generally have their parents set to the master
class Enemy extends Entity {
	constructor(tracker, frames, x, y, health) {
		super(tracker, frames, x, y);
		this.health = health;
	}

	onCollide(projectile) {
		this.health -= projectile.damage;
		projectile.destroy();
		if (this.health <= 0) {
			this.destroy();
			player.score += 5;
		}
	}

	destroy() {
		super.destroy();
	}
}

//projectiles have their parents set to either enemyProjectiles or playerProjectiles
class Projectile extends Entity {
	constructor(tracker, frames, x, y, damage) {
		super(tracker, frames, x, y);
		this.damage = damage;
	}

	setRelativeTo(entity, xoff, yoff) {
		this.addEvent(0, (self) => {
			if (entity.destroyed) {
				self.mutateEvent(createDestructor());
				return 0;
			}
			self.handle.x = entity.handle.x + xoff;
			self.handle.y = entity.handle.y + yoff;
			return REMOVE_EVENT;
		});
		return this;
	}
}

class BoundedProjectile extends Projectile {
	constructor(tracker, frames, x, y, damage) {
		super(tracker, frames, x, y, damage);
	}

	onUpdate(_) {
		if (!this.destroyed && this.ensureAlive() && (this.handle.x < 0 || this.handle.x > app.renderer.width ||
			this.handle.y < 0 || this.handle.y > app.renderer.height)) {
			this.destroy();
		} else {
			super.onUpdate(_);
		}
	}
}

class Player {
	constructor() {
		this.health = 1;
		this.shootCooldown = 0;
		this.gc = new GarbageCollector();
		this.score = 0;

		this.handle = new PIXI.extras.AnimatedSprite(animations["playerIdle"].frames);
		this.handle.loop = animations["playerIdle"].loop;
		this.handle.x = app.renderer.width / 2;
		this.handle.y = app.renderer.height - 64;
		this.handle.anchor.set(0.5);
		this.handle.animationSpeed = 0.5;
		this.handle.play();
		app.stage.addChild(this.handle);
	}

	runAnimation(name) {
		if (this.currentAnim != name) {
			this.currentAnim = name;
			this.handle.textures = animations[name].frames;
			this.handle.loop = animations[name].loop;
			this.handle.gotoAndPlay(0);
		}
	}

	move(x, y) {
		let minx = this.handle.width / 2;
		let maxx = app.renderer.width - minx;
		let miny = this.handle.height / 2;
		let maxy = app.renderer.height - miny;

		this.handle.x += x;
		this.handle.y += y;

		if (this.handle.x < minx) {
			this.handle.x = minx;
		} else if (this.handle.x > maxx) {
			this.handle.x = maxx;
		}
		if (this.handle.y < miny) {
			this.handle.y = miny;
		} else if (this.handle.y > maxy) {
			this.handle.y = maxy;
		}
	}

	shoot(focus) {
		if (focus) {
			new BoundedProjectile(playerProjectiles, "projectileFocusIdle", this.handle.x, this.handle.y, 3).addEvent(0, (self) => {
				self.handle.y -= 4;
				return 10;
			}).dispatch(playerProjectiles);
			player.shootCooldown = PLAYER_COOLDOWN_READY;
		} else {
			let trio = [
				new BoundedProjectile(playerProjectiles, "projectileKnifeIdle315", this.handle.x - 10, this.handle.y, 1).addEvent(0, (self) => {
					self.handle.x -= 1;
					self.handle.y -= 3;
					return 10;
				}),
				new BoundedProjectile(playerProjectiles, "projectileKnifeIdle0", this.handle.x, this.handle.y, 1).addEvent(0, (self) => {
					self.handle.y -= 3;
					return 10;
				}),
				new BoundedProjectile(playerProjectiles, "projectileKnifeIdle45", this.handle.x + 10, this.handle.y, 1).addEvent(0, (self) => {
					self.handle.x += 1;
					self.handle.y -= 3;
					return 10;
				})
			];
			for (var k = 0; k < 3; k++) {
				trio[k].dispatch(playerProjectiles);
			}
			player.shootCooldown = PLAYER_COOLDOWN_READY;
		}
	}

	onCollide(projectile) {
		this.health -= projectile.damage;
		projectile.destroy();
		if (this.health <= 0) {
			console.log("You died.");
			console.log("You scored", player.score, "points!");
			$.post("/highscores",{score: player.score});
			allowGameLoop = false;
			master.destroy();
		}
	}
}

const VK_X = 88; //bomb
const VK_Z = 90; //shoot (can hold)
const VK_ESC = 27; //pause
const VK_SHIFT = 16; //slow/focus
const VK_UP = 38;
const VK_DOWN = 40;
const VK_LEFT = 37;
const VK_RIGHT = 39;
const VK_W = 87;
const VK_A = 65;
const VK_S = 83;
const VK_D = 68;
let keys = {};

window.addEventListener("keydown", (e) => {
	keys[e.keyCode] = true;
	keys[VK_SHIFT] = e.shiftKey;
});
window.addEventListener("keyup", (e) => {
	keys[e.keyCode] = false;
	keys[VK_SHIFT] = e.shiftKey;
});

animations.execute();
PIXI.loader.onComplete.add(() => {
	player = new Player();
	let replay = new List(1000);
	let pastAct = [];
	app.ticker.add(() => {
		if (!allowGameLoop) {
			return;
		}

		let xdir = 0;
		let ydir = 0;
		if ((keys[VK_UP] || keys[VK_W]) && ydir == 0) {
			ydir = -1;
		}
		if ((keys[VK_LEFT] || keys[VK_A]) && xdir == 0) {
			xdir = -1;
		}
		if ((keys[VK_RIGHT] || keys[VK_D]) && xdir == 0) {
			xdir = 1;
		}
		if ((keys[VK_DOWN] || keys[VK_S]) && ydir == 0) {
			ydir = 1;
		}
		if (xdir < 0) {
			player.runAnimation("playerIdleLeft");
		} else if (xdir > 0) {
			player.runAnimation("playerIdleRight");
		} else {
			player.runAnimation("playerIdle");
		}
		player.move(xdir * MOVEMENT_SPEED, ydir * MOVEMENT_SPEED);

		if(player.shootCooldown == 0) {
			if (keys[VK_Z]) {
				player.shoot(keys[VK_SHIFT]);
			}
		}else {
			player.shootCooldown--;
		}

		let projectile, enemy;
		for (var k = 0, length = playerProjectiles.length; k < length; ++k) {
			projectile = playerProjectiles.get(k);
			if (projectile !== null) {
				for (var h = 0, length2 = enemies.length; h < length2; ++h) {
					enemy = enemies.get(h);
					if (enemy !== null) {
						if (projectile.handle.x >= enemy.handle.x - 10 && projectile.handle.x <= enemy.handle.x + 10 &&
							projectile.handle.y >= enemy.handle.y - 10 && projectile.handle.y <= enemy.handle.y + 10) {
							enemy.onCollide(projectile);
							break;
						}
					}
				}
			}
		}
		for (var k = 0, length = enemyProjectiles.length; k < length; ++k) {
			let projectile = enemyProjectiles.get(k);
			if (projectile !== null) {
				if (projectile.handle.x >= player.handle.x - PLAYER_HITBOX && projectile.handle.x <= player.handle.x + PLAYER_HITBOX &&
					projectile.handle.y >= player.handle.y - PLAYER_HITBOX && projectile.handle.y <= player.handle.y + PLAYER_HITBOX) {
					player.onCollide(projectile);
					break;
				}
			}
		}
		//TODO add player colliding with enemies. 1 damage
	});
	initializeStage();
	master.dispatch();
});
