export const QUADRANTS: {id:string;label:string;detail:string}[];
export function localDay(date?:Date):string;
export function shiftDay(day:string,n:number):string;
export function habitDays(habit:any,day?:string,count?:number):{date:string;status:string;mark:string}[];
export function checkHabit(habit:any,status:string,day?:string,now?:number):any;
export function newHabit(id:string,title:string,goalId?:string|null):any;
