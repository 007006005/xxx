export default class Entity {
    id;
    x;
    y;
    size;
    name;
    color;
    skinName;
    accountID;
    isMine;
    isFood;
    isVirus;
    isFriend;
    agitated;
    constructor(id, accountID) {
        this.id = id;
        this.x = 0;
        this.y = 0;
        this.size = 0;
        this.name = '';
        this.color = '';
        this.skinName = '';
        this.isMine = false;
        this.isFood = false;
        this.isVirus = false;
        this.agitated = false;
        this.isFriend = false;
        this.accountID = accountID;
    }
    destroy(bot) {
        delete bot.myCellIds[this.id];
        delete bot.playerCells[this.id];
        const index = bot.ownCells.indexOf(this);
        if (index !== -1)
            bot.ownCells.splice(index, 1);
    }
}
