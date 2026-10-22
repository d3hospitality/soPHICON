export interface WonderMoment {id:string;title:string;theme:string;minutes:number;question:string;action:string;goalAction:string;quote:{philId:string;philName:string;text:string;source:string}}
export const WONDER_MOMENTS: WonderMoment[];
export function wonderDay(date?:Date):string;
export function momentForDay(day?:string,offset?:number):WonderMoment;
export function wonderMove(moment:WonderMoment,day:string,goal?:{id:string;status:string}|null,now?:number):{id:string;text:string;goalId:string|null;status:'open';createdAt:number;updatedAt:number;quadrant:string;minutes:number;date:string;reason:string;philId:string;philName:string;origin:'wonder';wonderId:string};
export function isVisiblePracticeMove(move:{status:string;goalId:string|null;origin?:string},goals:{id:string;status:string}[]):boolean;
